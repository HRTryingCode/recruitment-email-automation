// Gem enrichment over GeMCP (F3), Gem's MCP server at https://mcp.gem.com/mcp.
//
// Auth is per-user MCP OAuth 2.1: RFC 9728 discovery -> dynamic client
// registration (public client, token_endpoint_auth_method "none") -> PKCE
// authorize -> code exchange. No pre-registered client: Gem's authorization
// server advertises a registration_endpoint, so each user's connect
// registers our redirect URI (gemRedirectUri()) itself.
//
// Gem is OPTIONAL and UNSTABLE from our point of view (an MCP tool surface,
// not a versioned API): every lookup is time-boxed (10s overall, 8s per MCP
// call, 8s per OAuth request), tool output is
// parsed defensively, and any surprise degrades to UNAVAILABLE so the Add
// to Lever dialog still works with manual input. Read-only: only the
// `search` and `get_person` tools are ever called.
//
// Tokens, the PKCE verifier and résumé URLs are never logged. Tokens are
// stored encrypted (lib/crypto) in GemConnection.
//
// Speed (H5): a prod lookup took 13.6s, mostly per-request setup. Within a
// function instance we now keep the OAuth discovery metadata (1h), one
// connected MCP client per user (reused while its access token is unchanged
// and it was used in the last 4 min), and a single in-flight token refresh
// per user; `get_person` calls for the top search hits run in parallel.
// Every lookup reports per-step timings (GemLookup.timings).
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  discoverOAuthServerInfo,
  registerClient,
  startAuthorization,
  exchangeAuthorization,
  refreshAuthorization,
  type OAuthServerInfo,
} from '@modelcontextprotocol/sdk/client/auth.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { OAuthClientInformationFull, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import { prisma } from '../db/client';
import { encrypt, decrypt } from '../lib/crypto';
import { createOAuthState } from '../lib/oauthState';
import { safeError } from '../lib/safeError';
import { logEvent } from './monitoring.service';
import { normalizeLinkedinUrl } from '../lib/linkedin';

export const GEM_MCP_URL = process.env.GEM_MCP_URL ?? 'https://mcp.gem.com/mcp';
export const GEM_UNAVAILABLE_MESSAGE = 'Gem unavailable — paste LinkedIn manually';
const GEM_SCOPE = 'openid email profile';
const DEFAULT_TIMEOUT_MS = 10_000;
const CALL_TIMEOUT_MS = 8_000;
const OAUTH_TIMEOUT_MS = 8_000;
const CLIENT_IDLE_MS = 4 * 60 * 1000;
// Refresh a little before expiry so a token can't lapse mid-lookup.
const REFRESH_SKEW_MS = 60_000;
const DISCOVERY_TTL_MS = 60 * 60 * 1000;

export const GEM_STATUS_OK = 'OK';
export const GEM_STATUS_PENDING = 'PENDING';
export const GEM_STATUS_NEEDS_REAUTH = 'NEEDS_REAUTH';

type FetchFn = typeof fetch;

export interface GemDeps {
  fetchFn?: FetchFn;
  /** Tests: an in-process MCP transport instead of HTTP to mcp.gem.com. */
  transportFactory?: (accessToken: string) => Transport;
  /** Whole lookup (after the token). */
  timeoutMs?: number;
  /** Each MCP tool call. */
  callTimeoutMs?: number;
}

/** OAuth requests (discovery, refresh) get their own 8s cap: they run before the lookup timeout starts. */
function timedFetch(fetchFn: FetchFn | undefined): FetchFn {
  const f = fetchFn ?? fetch;
  return ((input: Parameters<FetchFn>[0], init?: RequestInit) =>
    f(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(OAUTH_TIMEOUT_MS) })) as FetchFn;
}

/**
 * OAuth redirect URI for the Gem connect flow. The API and SPA share an
 * origin on Vercel, so FRONTEND_URL (or GEM_OAUTH_REDIRECT_BASE) is also the
 * API base. Registered with Gem via dynamic client registration on each
 * user's first connect.
 */
export function gemRedirectUri(): string {
  return `${appBaseUrl()}/api/integrations/gem/callback`;
}

/** Public origin of the app (SPA + API). Falls back to the prod domain on Vercel. */
export function appBaseUrl(): string {
  const base =
    process.env.GEM_OAUTH_REDIRECT_BASE ??
    process.env.FRONTEND_URL ??
    (process.env.VERCEL ? 'https://recruiting-email-automation-api.vercel.app' : 'http://localhost:5173');
  return base.replace(/\/+$/, '');
}

type DiscoveredInfo = OAuthServerInfo & {
  authorizationServerMetadata: NonNullable<OAuthServerInfo['authorizationServerMetadata']>;
};

let discoveryCache: { at: number; info: DiscoveredInfo } | null = null;

/** Tests only. */
export function __resetGemDiscoveryCache(): void {
  discoveryCache = null;
}

async function discover(fetchFn?: FetchFn): Promise<DiscoveredInfo> {
  if (!discoveryCache || Date.now() - discoveryCache.at > DISCOVERY_TTL_MS) {
    const info = await discoverOAuthServerInfo(GEM_MCP_URL, { fetchFn: timedFetch(fetchFn) });
    const metadata = info.authorizationServerMetadata;
    if (!metadata) throw new Error('Gem OAuth metadata not found');
    discoveryCache = { at: Date.now(), info: { ...info, authorizationServerMetadata: metadata } };
  }
  return discoveryCache.info;
}

function resourceUrl(info: OAuthServerInfo): URL {
  return new URL(info.resourceMetadata?.resource ?? GEM_MCP_URL);
}

function registrationMatches(reg: unknown): reg is OAuthClientInformationFull {
  if (!reg || typeof reg !== 'object') return false;
  const r = reg as { client_id?: unknown; redirect_uris?: unknown };
  return (
    typeof r.client_id === 'string' &&
    Array.isArray(r.redirect_uris) &&
    r.redirect_uris.includes(gemRedirectUri())
  );
}

function expiresAtFrom(tokens: OAuthTokens): Date | null {
  return typeof tokens.expires_in === 'number' ? new Date(Date.now() + tokens.expires_in * 1000) : null;
}

/** Starts the connect: returns Gem's authorize URL (state bound to `userId`). */
export async function buildGemAuthUrl(userId: string, deps: GemDeps = {}): Promise<string> {
  const info = await discover(deps.fetchFn);
  const existing = await prisma.gemConnection.findUnique({ where: { userId } });

  let clientInformation: OAuthClientInformationFull;
  if (registrationMatches(existing?.clientRegistration)) {
    clientInformation = existing!.clientRegistration as unknown as OAuthClientInformationFull;
  } else {
    clientInformation = await registerClient(info.authorizationServerUrl, {
      metadata: info.authorizationServerMetadata,
      clientMetadata: {
        client_name: 'Archive Recruiting Email Automation',
        redirect_uris: [gemRedirectUri()],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
        scope: GEM_SCOPE,
      },
      fetchFn: deps.fetchFn,
    });
  }

  const state = await createOAuthState(userId, 'gem');
  const { authorizationUrl, codeVerifier } = await startAuthorization(info.authorizationServerUrl, {
    metadata: info.authorizationServerMetadata,
    clientInformation,
    redirectUrl: gemRedirectUri(),
    scope: GEM_SCOPE,
    state,
    resource: resourceUrl(info),
  });

  const registration = JSON.parse(JSON.stringify(clientInformation));
  const pendingVerifier = encrypt(codeVerifier);
  await prisma.gemConnection.upsert({
    where: { userId },
    create: { userId, clientRegistration: registration, pendingVerifier, status: GEM_STATUS_PENDING },
    update: { clientRegistration: registration, pendingVerifier },
  });
  return authorizationUrl.toString();
}

/** OAuth callback leg: exchange `code` for tokens for the state's user. */
export async function completeGemAuth(userId: string, code: string, deps: GemDeps = {}): Promise<void> {
  const row = await prisma.gemConnection.findUnique({ where: { userId } });
  if (!row?.pendingVerifier || !registrationMatches(row.clientRegistration)) {
    throw new Error('No pending Gem authorization for this user');
  }
  const info = await discover(deps.fetchFn);
  const tokens = await exchangeAuthorization(info.authorizationServerUrl, {
    metadata: info.authorizationServerMetadata,
    clientInformation: row.clientRegistration as unknown as OAuthClientInformationFull,
    authorizationCode: code,
    codeVerifier: decrypt(row.pendingVerifier),
    redirectUri: gemRedirectUri(),
    resource: resourceUrl(info),
    fetchFn: deps.fetchFn,
  });
  await prisma.gemConnection.update({
    where: { userId },
    data: {
      tokens: encrypt(JSON.stringify(tokens)),
      expiresAt: expiresAtFrom(tokens),
      status: GEM_STATUS_OK,
      lastError: null,
      pendingVerifier: null,
    },
  });
  await logEvent('GEM_CONNECTED', { userId }, 'INFO');
}

export type GemConnectionState = 'NOT_CONNECTED' | 'PENDING' | 'OK' | 'NEEDS_REAUTH';

export async function gemConnectionStatus(
  userId: string
): Promise<{ status: GemConnectionState; lastError: string | null; updatedAt: string | null }> {
  const row = await prisma.gemConnection.findUnique({ where: { userId } });
  if (!row) return { status: 'NOT_CONNECTED', lastError: null, updatedAt: null };
  const status: GemConnectionState =
    row.status === GEM_STATUS_NEEDS_REAUTH ? 'NEEDS_REAUTH' : row.tokens ? 'OK' : 'PENDING';
  return {
    status,
    lastError: row.lastError ?? null,
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null,
  };
}

export async function disconnectGem(userId: string): Promise<void> {
  await prisma.gemConnection.deleteMany({ where: { userId } });
  await logEvent('GEM_DISCONNECTED', { userId }, 'INFO');
}

async function markNeedsReauth(userId: string, err: unknown, source: string): Promise<void> {
  const { message } = safeError(err);
  try {
    const res = await prisma.gemConnection.updateMany({
      where: { userId, status: { not: GEM_STATUS_NEEDS_REAUTH } },
      data: { status: GEM_STATUS_NEEDS_REAUTH, lastError: message.slice(0, 300) },
    });
    if (res.count === 0) return;
  } catch (dbErr) {
    console.error('[Gem] failed to mark NEEDS_REAUTH:', safeError(dbErr));
    return;
  }
  await logEvent('GEM_AUTH_REVOKED', { userId, source, error: message.slice(0, 300) }, 'WARN');
}

export type GemTokenResult = { ok: true; token: string } | { ok: false; status: 'NOT_CONNECTED' | 'NEEDS_REAUTH' };

/** One refresh per user at a time: Gem rotates refresh tokens, so a second concurrent refresh would fail. */
const refreshing = new Map<string, Promise<GemTokenResult>>();

/** Valid access token for `userId`, refreshing if it expires within 60s. */
export async function getGemAccessToken(userId: string, deps: GemDeps = {}): Promise<GemTokenResult> {
  return accessToken(userId, deps, {});
}

async function accessToken(userId: string, deps: GemDeps, stats: { refreshMs?: number }): Promise<GemTokenResult> {
  const row = await prisma.gemConnection.findUnique({ where: { userId } });
  if (!row?.tokens) return { ok: false, status: 'NOT_CONNECTED' };
  if (row.status === GEM_STATUS_NEEDS_REAUTH) return { ok: false, status: 'NEEDS_REAUTH' };

  let tokens: OAuthTokens;
  try {
    tokens = JSON.parse(decrypt(row.tokens)) as OAuthTokens;
  } catch (err) {
    await markNeedsReauth(userId, err, 'decrypt');
    return { ok: false, status: 'NEEDS_REAUTH' };
  }
  const expiring = row.expiresAt && new Date(row.expiresAt).getTime() - Date.now() < REFRESH_SKEW_MS;
  if (!expiring) return { ok: true, token: tokens.access_token };

  if (!tokens.refresh_token || !registrationMatches(row.clientRegistration)) {
    await markNeedsReauth(userId, new Error('Gem token expired and cannot be refreshed'), 'refresh');
    return { ok: false, status: 'NEEDS_REAUTH' };
  }
  const t0 = Date.now();
  let pending = refreshing.get(userId);
  if (!pending) {
    pending = refreshTokens(userId, row.clientRegistration as unknown as OAuthClientInformationFull, tokens.refresh_token, deps);
    refreshing.set(userId, pending);
    void pending.finally(() => refreshing.delete(userId));
  }
  const out = await pending;
  stats.refreshMs = Date.now() - t0;
  return out;
}

async function refreshTokens(
  userId: string,
  clientInformation: OAuthClientInformationFull,
  refreshToken: string,
  deps: GemDeps
): Promise<GemTokenResult> {
  try {
    const info = await discover(deps.fetchFn);
    const fresh = await refreshAuthorization(info.authorizationServerUrl, {
      metadata: info.authorizationServerMetadata,
      clientInformation,
      refreshToken,
      resource: resourceUrl(info),
      fetchFn: timedFetch(deps.fetchFn),
    });
    await prisma.gemConnection.update({
      where: { userId },
      data: { tokens: encrypt(JSON.stringify(fresh)), expiresAt: expiresAtFrom(fresh), status: GEM_STATUS_OK, lastError: null },
    });
    return { ok: true, token: fresh.access_token };
  } catch (err) {
    await markNeedsReauth(userId, err, 'refresh');
    return { ok: false, status: 'NEEDS_REAUTH' };
  }
}

// ── Lookup ────────────────────────────────────────────────────────────────

export interface GemResume {
  /** Presigned (≈7 days). Server-side only: never sent to the browser or logged. */
  url: string;
  filename: string;
  source: string | null;
}

export interface GemPerson {
  /** Gem's person ext_id (cached on Candidate.gemPersonId; lets later lookups skip search). */
  id: string | null;
  name: string;
  title: string | null;
  company: string | null;
  location: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  /** Newest résumé (Gem lists newest first). */
  resume: GemResume | null;
}

export type GemLookupStatus = 'FOUND' | 'NOT_FOUND' | 'NOT_CONNECTED' | 'NEEDS_REAUTH' | 'UNAVAILABLE';

/** Where a lookup's time went (ms). Logged on GEM_PREFILL; no PII. */
export interface GemTimings {
  /** DB read + decrypt + any refresh. */
  tokenMs: number;
  tokenRefreshMs: number;
  /** MCP initialize handshake; 0 when a cached client was reused. */
  mcpConnectMs: number;
  searchMs: number;
  /** All get_person calls (parallel). */
  getPersonMs: number;
  totalMs: number;
  /** First lookup in this function instance (cold start, empty caches). */
  cold: boolean;
  clientReused: boolean;
}

export interface GemLookup {
  status: GemLookupStatus;
  person?: GemPerson;
  message?: string;
  timings?: GemTimings;
}

/** Thrown inside a lookup when Gem's output doesn't look like we expect. */
class GemShapeError extends Error {}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

function firstString(list: unknown, keys: string[]): string | null {
  if (!Array.isArray(list)) return null;
  for (const item of list) {
    if (typeof item === 'string' && item.trim()) return item.trim();
    if (item && typeof item === 'object') {
      for (const k of keys) {
        const v = str((item as Record<string, unknown>)[k]);
        if (v) return v;
      }
    }
  }
  return null;
}

function allStrings(list: unknown, keys: string[]): string[] {
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const item of list) {
    if (typeof item === 'string') out.push(item);
    else if (item && typeof item === 'object') {
      for (const k of keys) {
        const v = str((item as Record<string, unknown>)[k]);
        if (v) out.push(v);
      }
    }
  }
  return out.map((s) => s.trim().toLowerCase());
}

/** Maps a `get_person` entity to GemPerson; null when it has no usable name. */
export function parseGemPerson(entity: unknown): GemPerson | null {
  if (!entity || typeof entity !== 'object' || Array.isArray(entity)) return null;
  const e = entity as Record<string, unknown>;
  const name = str(e.display_name) ?? str(e.name);
  if (!name) return null;

  let resume: GemResume | null = null;
  if (Array.isArray(e.resumes)) {
    for (const r of e.resumes) {
      if (!r || typeof r !== 'object') continue;
      const o = r as Record<string, unknown>;
      const url = str(o.url) ?? str(o.download_url) ?? str(o.presigned_url);
      if (!url || !url.startsWith('https://')) continue;
      resume = {
        url,
        filename: str(o.file_name) ?? str(o.filename) ?? str(o.name) ?? 'resume.pdf',
        source: str(o.source) ?? str(o.type) ?? null,
      };
      break;
    }
  }

  return {
    id: str(e.ext_id) ?? str(e.id),
    name,
    title: str(e.title),
    company: str(e.company),
    location: str(e.location),
    phone: firstString(e.phone_numbers, ['number', 'phone_number', 'value']),
    linkedinUrl: normalizeLinkedinUrl(e.linkedin_url),
    resume,
  };
}

/** Parses a CallToolResult into JSON: structuredContent, else the first text block. */
function toolJson(result: unknown): Record<string, unknown> {
  const r = result as { isError?: boolean; structuredContent?: unknown; content?: unknown };
  if (r?.isError) throw new GemShapeError('tool error');
  if (r?.structuredContent && typeof r.structuredContent === 'object') {
    return r.structuredContent as Record<string, unknown>;
  }
  const text = Array.isArray(r?.content)
    ? (r.content as Array<{ type?: string; text?: unknown }>).find((c) => c?.type === 'text' && typeof c.text === 'string')?.text
    : undefined;
  if (typeof text !== 'string') throw new GemShapeError('no text content');
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new GemShapeError('not an object');
    return parsed as Record<string, unknown>;
  } catch (err) {
    if (err instanceof GemShapeError) throw err;
    throw new GemShapeError('not json');
  }
}

function isUnauthorized(err: unknown): boolean {
  const e = err as { code?: unknown; name?: string };
  return e?.code === 401 || e?.name === 'UnauthorizedError';
}

// ── MCP client reuse (per function instance) ───────────────────────────────

interface CachedClient {
  token: string;
  client: Client;
  connected: Promise<void>;
  lastUsed: number;
}

const clients = new Map<string, CachedClient>();
let instanceWarm = false;

/** Tests only. */
export function __resetGemClientCache(): void {
  for (const entry of clients.values()) entry.client.close().catch(() => {});
  clients.clear();
  refreshing.clear();
  instanceWarm = false;
}

function evictClient(userId: string, entry: CachedClient): void {
  if (clients.get(userId) === entry) clients.delete(userId);
  entry.client.close().catch(() => {});
}

/** A connected client for this user + token: the cached one when still usable, else a new one. */
async function clientFor(
  userId: string,
  token: string,
  deps: GemDeps
): Promise<{ entry: CachedClient; reused: boolean; connectMs: number }> {
  const now = Date.now();
  const cached = clients.get(userId);
  if (cached && cached.token === token && now - cached.lastUsed < CLIENT_IDLE_MS) {
    cached.lastUsed = now;
    await cached.connected;
    return { entry: cached, reused: true, connectMs: 0 };
  }
  if (cached) evictClient(userId, cached);

  const client = new Client({ name: 'recruitment-email-automation', version: '1.0.0' });
  const transport =
    deps.transportFactory?.(token) ??
    new StreamableHTTPClientTransport(new URL(GEM_MCP_URL), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    });
  const entry: CachedClient = { token, client, connected: client.connect(transport), lastUsed: now };
  clients.set(userId, entry);
  try {
    await entry.connected;
  } catch (err) {
    evictClient(userId, entry);
    throw err;
  }
  return { entry, reused: false, connectMs: Date.now() - now };
}

/**
 * Best Gem match for `email`. Never throws: problems come back as
 * NOT_CONNECTED / NEEDS_REAUTH / UNAVAILABLE. With `extId` (a cached Gem
 * person id) the search is skipped; the email check still applies.
 */
export async function lookupGemPerson(
  userId: string,
  email: string,
  deps: GemDeps & { extId?: string | null } = {}
): Promise<GemLookup> {
  const t0 = Date.now();
  const cold = !instanceWarm;
  instanceWarm = true;
  const timings: GemTimings = {
    tokenMs: 0,
    tokenRefreshMs: 0,
    mcpConnectMs: 0,
    searchMs: 0,
    getPersonMs: 0,
    totalMs: 0,
    cold,
    clientReused: false,
  };
  const done = (out: GemLookup): GemLookup => {
    timings.totalMs = Date.now() - t0;
    return { ...out, timings };
  };
  const unavailable: GemLookup = { status: 'UNAVAILABLE', message: GEM_UNAVAILABLE_MESSAGE };

  let token: GemTokenResult;
  const stats: { refreshMs?: number } = {};
  try {
    token = await accessToken(userId, deps, stats);
  } catch (err) {
    console.warn('[Gem] token lookup failed:', safeError(err).message);
    return done(unavailable);
  } finally {
    timings.tokenMs = Date.now() - t0;
    timings.tokenRefreshMs = stats.refreshMs ?? 0;
  }
  if (!token.ok) return done({ status: token.status });

  const normalized = email.trim().toLowerCase();
  const callOpts = { timeout: deps.callTimeoutMs ?? CALL_TIMEOUT_MS };
  let entry: CachedClient | undefined;

  const work = async (): Promise<GemLookup> => {
    const got = await clientFor(userId, token.token, deps);
    entry = got.entry;
    timings.clientReused = got.reused;
    timings.mcpConnectMs = got.connectMs;
    const client = got.entry.client;

    let extIds: string[];
    if (deps.extId) {
      extIds = [deps.extId];
    } else {
      const ts = Date.now();
      const search = toolJson(
        await client.callTool({ name: 'search', arguments: { kind: 'person', query: normalized, max_results: 5 } }, undefined, callOpts)
      );
      timings.searchMs = Date.now() - ts;
      if (!Array.isArray(search.results)) throw new GemShapeError('search.results');
      extIds = (search.results as unknown[])
        .map((r) => (r && typeof r === 'object' ? str((r as Record<string, unknown>).ext_id) : null))
        .filter((x): x is string => !!x)
        .slice(0, 3);
    }

    // Independent reads: fetch all candidates at once, then take the first
    // (in search order) whose emails include ours.
    const tp = Date.now();
    const people = await Promise.all(
      extIds.map(async (extId) =>
        toolJson(
          await client.callTool({ name: 'get_person', arguments: { ext_id: extId, fields: ['work_history', 'resumes'] } }, undefined, callOpts)
        )
      )
    );
    timings.getPersonMs = Date.now() - tp;
    for (const [i, got] of people.entries()) {
      if (got.found !== true) continue;
      const parsed = parseGemPerson(got.entity);
      if (!parsed) throw new GemShapeError('get_person.entity');
      const person = { ...parsed, id: parsed.id ?? extIds[i]! };
      // A free-text search can match on name; when Gem lists emails, require ours.
      const emails = allStrings((got.entity as Record<string, unknown>).emails, ['email_address', 'email', 'value']);
      if (emails.length > 0 && !emails.includes(normalized)) continue;
      return { status: 'FOUND', person };
    }
    return { status: 'NOT_FOUND' };
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  });
  try {
    const out = await Promise.race([work(), timeout]);
    if (out === 'timeout') {
      console.warn('[Gem] lookup timed out');
      if (entry) evictClient(userId, entry);
      else {
        const pending = clients.get(userId);
        if (pending?.token === token.token) evictClient(userId, pending);
      }
      return done(unavailable);
    }
    return done(out);
  } catch (err) {
    // Shape errors are about Gem's output; anything else may be a dead session.
    if (!(err instanceof GemShapeError)) {
      const current = entry ?? clients.get(userId);
      if (current) evictClient(userId, current);
    }
    if (isUnauthorized(err)) {
      await markNeedsReauth(userId, err, 'mcp');
      return done({ status: 'NEEDS_REAUTH' });
    }
    console.warn('[Gem] lookup degraded:', err instanceof GemShapeError ? `unexpected shape (${err.message})` : safeError(err).message);
    return done(unavailable);
  } finally {
    clearTimeout(timer);
  }
}
