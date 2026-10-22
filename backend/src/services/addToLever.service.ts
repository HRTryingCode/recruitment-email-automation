// F3 "Add to Lever": proposes a Lever opportunity for a candidate (prefill)
// and creates it once a recruiter confirms. Used by routes/candidate-lever.ts
// (known candidates), routes/lookup.ts (any email) and routes/lever.ts.
//
// Safety rails, in order, on every create:
//   1. LEVER_CREATE_ENABLED must be exactly 'true' (403 otherwise).
//   2. Idempotency: the same key within 10 min returns the first result —
//      in-process (a shared in-flight promise) and across instances (the
//      LEVER_OPPORTUNITY_CREATED SystemLog row carries the key).
//   3. The clicker must have a Lever user (perform_as and owner).
//   4. The posting must still be open; the stage must exist.
//   5. Lever must be reachable for a duplicate check, and the email must not
//      already have an opportunity on that posting.
// The résumé (if any) is streamed from Gem's presigned URL straight into the
// multipart create; it is never stored. Only the LinkedIn URL and the
// gem* cache columns (gemEnrichment.service) are kept.
//
// Prefill is split (H5) so the dialog opens on app data in < 300ms:
// buildPrefill = DB + cached Lever columns + postings/stages (no Gem);
// buildGemPrefill = Gem only, served from the Candidate gem* cache when
// fresh and refreshed in the background when stale.
import { z } from 'zod';
import { prisma } from '../db/client';
import { LeverClient, leverOpportunityUrl, type LeverOpportunity, type LeverState, type LeverStatus } from './lever.service';
import {
  LeverWriteClient,
  LeverWriteError,
  type LeverPosting,
  type LeverStage,
  type LeverResumeFile,
} from './leverWrite.service';
import {
  appBaseUrl,
  gemConnectionStatus,
  lookupGemPerson,
  type GemLookup,
  type GemLookupStatus,
} from './gem.service';
import { gemCacheState, persistGemEnrichment, scheduleGemEnrichment } from './gemEnrichment.service';
import { normalizeLinkedinUrl } from '../lib/linkedin';
import { refreshCandidateLever } from './leverSync.service';
import { logEvent } from './monitoring.service';
import { safeError } from '../lib/safeError';

export const DEFAULT_STAGE_NAME = 'Interest Call';
export const DEFAULT_SOURCES = ['Gem outreach'];
const CACHE_TTL_MS = 10 * 60 * 1000;
const IDEMPOTENCY_TTL_MS = 10 * 60 * 1000;
const MAX_EXCERPT = 500;
const MAX_RESUME_BYTES = 10 * 1024 * 1024;
const RESUME_TIMEOUT_MS = 15_000;
/** Cached Candidate.lever* columns younger than this stand in for a live Lever check in the prefill. */
const LEVER_CACHE_FRESH_MS = 60 * 60 * 1000;

type Writer = Pick<
  LeverWriteClient,
  'configured' | 'listOpenPostings' | 'listStages' | 'findUserByEmail' | 'createOpportunity' | 'addNote'
>;
type Reader = Pick<LeverClient, 'configured' | 'findByEmail'>;

/** Swappable for tests (fake Lever / Gem / fetch). */
export const addToLeverDeps: {
  writer: () => Writer;
  reader: () => Reader;
  gemLookup: (userId: string, email: string, opts?: { extId?: string | null }) => Promise<GemLookup>;
  fetchFn: typeof fetch;
} = {
  writer: () => new LeverWriteClient(),
  reader: () => new LeverClient({ maxRetries: 1 }),
  gemLookup: (userId, email, opts) => lookupGemPerson(userId, email, opts),
  fetchFn: (...args) => fetch(...args),
};

export class AddToLeverError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly extra: Record<string, unknown> = {}
  ) {
    super(message);
  }
}

export function isLeverCreateEnabled(): boolean {
  return process.env.LEVER_CREATE_ENABLED === 'true';
}

// ── Caches (per function instance) ─────────────────────────────────────────
let postingsCache: { at: number; value: LeverPosting[] } | null = null;
let stagesCache: { at: number; value: LeverStage[] } | null = null;
const leverUserCache = new Map<string, { at: number; value: { id: string; name: string | null } | null }>();
const inflight = new Map<string, { at: number; promise: Promise<CreateResult> }>();

/** Tests only. */
export function __resetAddToLeverState(): void {
  postingsCache = null;
  stagesCache = null;
  leverUserCache.clear();
  inflight.clear();
}

function fresh<T>(c: { at: number; value: T } | null | undefined): c is { at: number; value: T } {
  return !!c && Date.now() - c.at < CACHE_TTL_MS;
}

function writerOrThrow(): Writer {
  const w = addToLeverDeps.writer();
  if (!w.configured) throw new AddToLeverError(503, 'Lever is not configured (LEVER_API_KEY missing).');
  return w;
}

export async function getOpenPostings(opts: { force?: boolean } = {}): Promise<LeverPosting[]> {
  if (!opts.force && fresh(postingsCache)) return postingsCache.value;
  const value = await writerOrThrow().listOpenPostings();
  postingsCache = { at: Date.now(), value };
  return value;
}

export async function getStages(): Promise<LeverStage[]> {
  if (fresh(stagesCache)) return stagesCache.value;
  const value = await writerOrThrow().listStages();
  stagesCache = { at: Date.now(), value };
  return value;
}

export function defaultStage(stages: LeverStage[]): LeverStage | null {
  const want = DEFAULT_STAGE_NAME.toLowerCase();
  return stages.find((s) => s.text.trim().toLowerCase() === want) ?? null;
}

async function actorEmail(userId: string): Promise<string | null> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  return u?.email?.toLowerCase() ?? null;
}

export async function leverUserFor(email: string): Promise<{ id: string; name: string | null } | null> {
  const cached = leverUserCache.get(email);
  if (fresh(cached)) return cached.value;
  const u = await writerOrThrow().findUserByEmail(email);
  const value = u ? { id: u.id, name: u.name } : null;
  leverUserCache.set(email, { at: Date.now(), value });
  return value;
}

export async function leverMe(userId: string) {
  const email = await actorEmail(userId);
  const writer = addToLeverDeps.writer();
  const leverUser = writer.configured && email ? await leverUserFor(email) : null;
  return { configured: writer.configured, createEnabled: isLeverCreateEnabled(), appEmail: email, leverUser };
}

// ── Pure helpers ───────────────────────────────────────────────────────────

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Best open posting for a detected role: exact (normalized) title, then
 * containment (role "Senior Backend Engineer" ⊇ "Backend Engineer"), then
 * ≥ 2/3 token overlap. Published beats internal on ties. Null when nothing
 * is close — the recruiter picks.
 */
export function suggestPosting(role: string | null | undefined, postings: LeverPosting[]): LeverPosting | null {
  const r = norm(role ?? '');
  if (!r || postings.length === 0) return null;
  const rTokens = new Set(r.split(' '));
  let best: { p: LeverPosting; score: number } | null = null;
  for (const p of postings) {
    const t = norm(p.title);
    if (!t) continue;
    let score = 0;
    if (t === r) score = 3;
    else if (r.includes(t) || t.includes(r)) score = 2;
    else {
      const tTokens = new Set(t.split(' '));
      const shared = [...rTokens].filter((x) => tTokens.has(x)).length;
      const overlap = shared / Math.max(rTokens.size, tTokens.size);
      if (overlap >= 2 / 3) score = 1 + overlap / 10;
    }
    if (score === 0) continue;
    if (p.state === 'published') score += 0.01;
    if (!best || score > best.score) best = { p, score };
  }
  return best?.p ?? null;
}

/** "paul.b@archive.com" → "paul.b" (the Lever tag for the sourcing inbox). */
export function mailboxTag(address: string | null | undefined): string | null {
  const m = (address ?? '').trim().toLowerCase().match(/^([^@\s]+)@[^@\s]+$/);
  return m ? m[1]! : null;
}

export function buildHeadline(title: string | null | undefined, company: string | null | undefined): string | null {
  const t = title?.trim();
  const c = company?.trim();
  if (t && c) return `${t} at ${c}`;
  return t || c || null;
}

const QUOTE_START = [/^On .+wrote:\s*$/i, /^>/, /^-{2,}\s*Original Message\s*-{2,}/i, /^From: .+/, /^-- $/, /^Sent from my /i];

/** The candidate's own words from a reply: quoted history dropped, ≤ 500 chars. */
export function replyExcerpt(bodyText: string | null | undefined): string | null {
  if (!bodyText) return null;
  const kept: string[] = [];
  for (const line of bodyText.split(/\r?\n/)) {
    if (QUOTE_START.some((re) => re.test(line.trim()))) break;
    kept.push(line);
  }
  const text = kept.join(' ').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return text.length > MAX_EXCERPT ? `${text.slice(0, MAX_EXCERPT - 1).trimEnd()}…` : text;
}

export function appUrl(): string {
  return appBaseUrl();
}

export function buildNoteText(p: {
  actorEmail: string | null;
  appUrl: string;
  candidateEmail: string;
  gmailUrl: string | null;
  reply: { text: string; at: Date } | null;
}): string {
  const lines = [
    `Added from Recruiting Email Automation${p.actorEmail ? ` by ${p.actorEmail}` : ''}.`,
    `Conversation: ${p.appUrl}/?tab=candidates&q=${encodeURIComponent(p.candidateEmail)}`,
  ];
  if (p.gmailUrl) lines.push(`Gmail thread: ${p.gmailUrl}`);
  if (p.reply) {
    lines.push('', `Latest reply (${p.reply.at.toISOString().slice(0, 10)}):`, p.reply.text);
  }
  return lines.join('\n');
}

// ── Prefill ────────────────────────────────────────────────────────────────

/** App-side half of the Add to Lever payload (no Gem). */
export interface LeverPrefill {
  candidateId: string | null;
  name: string | null;
  email: string;
  /** From the candidate's app title/company; Gem's fills in only if this is empty. */
  headline: string | null;
  /** Stored on the candidate (typed earlier, or cached from Gem). */
  linkedinUrl: string | null;
  suggestedPostingId: string | null;
  stageId: string | null;
  stageName: string;
  origin: 'sourced';
  sources: string[];
  tags: string[];
  note: string;
  existing: LeverOpportunity[];
  existingState: LeverState;
  createEnabled: boolean;
}

export interface PrefillTimings {
  dbMs: number;
  leverExistingMs: number;
  postingsMs: number;
  totalMs: number;
  /** Existing opportunities came from Candidate.lever* (no Lever call). */
  leverCached: boolean;
}

export type GemPrefillSource = 'live' | 'cache' | 'cache_stale';

/** Gem half of the payload. */
export interface LeverGemPrefill {
  status: GemLookupStatus;
  message?: string;
  source: GemPrefillSource;
  fetchedAt: string | null;
  name: string | null;
  headline: string | null;
  location: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  resume: { available: boolean; source: string | null; filename: string | null };
}

const candidateSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  title: true,
  company: true,
  linkedinUrl: true,
  leverState: true,
  leverOpportunityId: true,
  leverPostingTitle: true,
  leverStage: true,
  leverArchivedReason: true,
  leverCheckedAt: true,
  gemPersonId: true,
  gemTitle: true,
  gemCompany: true,
  gemLocation: true,
  gemResumeAvailable: true,
  gemFetchedAt: true,
  mailbox: { select: { emailAddress: true } },
} as const;

export type CandidateForPrefill = {
  id: string;
  name: string;
  email: string;
  role: string | null;
  title: string | null;
  company: string | null;
  linkedinUrl: string | null;
  leverState?: string | null;
  leverOpportunityId?: string | null;
  leverPostingTitle?: string | null;
  leverStage?: string | null;
  leverArchivedReason?: string | null;
  leverCheckedAt?: Date | string | null;
  gemPersonId?: string | null;
  gemTitle?: string | null;
  gemCompany?: string | null;
  gemLocation?: string | null;
  gemResumeAvailable?: boolean | null;
  gemFetchedAt?: Date | string | null;
  mailbox: { emailAddress: string } | null;
};

export async function findCandidateForPrefill(by: { id: string } | { email: string }): Promise<CandidateForPrefill | null> {
  if ('id' in by) {
    return (await prisma.candidate.findUnique({ where: { id: by.id }, select: candidateSelect })) as CandidateForPrefill | null;
  }
  return (await prisma.candidate.findFirst({
    where: { email: { equals: by.email, mode: 'insensitive' } },
    select: candidateSelect,
  })) as CandidateForPrefill | null;
}

const CACHEABLE_LEVER_STATES = new Set<LeverState>(['ACTIVE', 'ARCHIVED', 'HIRED', 'NOT_FOUND']);

/**
 * Lever status from the candidate's cached columns when checked < 1h ago
 * (cron, H2 create hook or webhook keep them fresh), else null. Only the
 * primary opportunity is cached; its postingId is matched by title against
 * the open postings so the "already on this job" check still works. The
 * create path always re-checks Lever live.
 */
export function cachedLeverStatus(c: CandidateForPrefill | null, postings: LeverPosting[], now = Date.now()): LeverStatus | null {
  if (!c?.leverCheckedAt || !c.leverState) return null;
  const state = c.leverState as LeverState;
  if (!CACHEABLE_LEVER_STATES.has(state)) return null;
  const checkedAt = new Date(c.leverCheckedAt);
  if (now - checkedAt.getTime() >= LEVER_CACHE_FRESH_MS) return null;
  let opportunities: LeverOpportunity[] = [];
  if (state !== 'NOT_FOUND' && c.leverOpportunityId) {
    const byTitle = c.leverPostingTitle ? postings.filter((p) => p.title === c.leverPostingTitle) : [];
    opportunities = [
      {
        id: c.leverOpportunityId,
        postingId: byTitle.length === 1 ? byTitle[0]!.id : null,
        postingTitle: c.leverPostingTitle ?? null,
        stage: c.leverStage ?? null,
        archived: state === 'ARCHIVED' || state === 'HIRED',
        hired: state === 'HIRED',
        archivedReason: c.leverArchivedReason ?? null,
        createdAt: null,
        updatedAt: null,
        leverUrl: leverOpportunityUrl(c.leverOpportunityId),
      },
    ];
  }
  return { state, primary: opportunities[0] ?? null, opportunities, checkedAt: checkedAt.toISOString() };
}

function timed<T>(p: Promise<T>): Promise<{ value: T; ms: number }> {
  const t0 = Date.now();
  return p.then((value) => ({ value, ms: Date.now() - t0 }));
}

export async function buildPrefill(args: {
  actorUserId: string;
  email: string;
  candidate: CandidateForPrefill | null;
}): Promise<{ prefill: LeverPrefill; timings: PrefillTimings }> {
  const t0 = Date.now();
  const email = args.email.trim().toLowerCase();
  const [lever, db] = await Promise.all([
    timed(
      Promise.all([getOpenPostings(), getStages()]).then(async ([postings, stages]) => {
        const postingsMs = Date.now() - t0;
        const cached = cachedLeverStatus(args.candidate, postings);
        const tl = Date.now();
        const status = cached ?? (await addToLeverDeps.reader().findByEmail(email));
        return { postings, stages, status, postingsMs, leverCached: !!cached, leverExistingMs: Date.now() - tl };
      })
    ),
    timed(
      Promise.all([
        actorEmail(args.actorUserId),
        prisma.emailMessage.findFirst({
          where: { fromAddress: { equals: email, mode: 'insensitive' } },
          orderBy: { receivedAt: 'desc' },
          select: {
            bodyText: true,
            receivedAt: true,
            mailbox: { select: { emailAddress: true } },
            thread: { select: { externalThreadId: true } },
          },
        }),
      ])
    ),
  ]);
  const { postings, stages, status } = lever.value;
  const [actor, latest] = db.value;

  const c = args.candidate;
  const mailbox = c?.mailbox?.emailAddress ?? latest?.mailbox?.emailAddress ?? null;
  const tag = mailboxTag(mailbox);
  const excerpt = replyExcerpt(latest?.bodyText);
  const gmailUrl =
    mailbox && latest?.thread?.externalThreadId
      ? `https://mail.google.com/mail/?authuser=${encodeURIComponent(mailbox)}#all/${encodeURIComponent(latest.thread.externalThreadId)}`
      : null;
  const stage = defaultStage(stages);

  const prefill: LeverPrefill = {
    candidateId: c?.id ?? null,
    name: c?.name?.trim() || null,
    email,
    headline: buildHeadline(c?.title, c?.company),
    linkedinUrl: normalizeLinkedinUrl(c?.linkedinUrl),
    suggestedPostingId: suggestPosting(c?.role, postings)?.id ?? null,
    stageId: stage?.id ?? null,
    stageName: stage?.text ?? DEFAULT_STAGE_NAME,
    origin: 'sourced',
    sources: DEFAULT_SOURCES,
    tags: tag ? [tag] : [],
    note: buildNoteText({
      actorEmail: actor,
      appUrl: appUrl(),
      candidateEmail: email,
      gmailUrl,
      reply: excerpt && latest ? { text: excerpt, at: latest.receivedAt } : null,
    }),
    existing: status.state === 'ERROR' ? [] : status.opportunities,
    existingState: status.state,
    createEnabled: isLeverCreateEnabled(),
  };
  return {
    prefill,
    timings: {
      dbMs: db.ms,
      leverExistingMs: lever.value.leverExistingMs,
      postingsMs: lever.value.postingsMs,
      totalMs: Date.now() - t0,
      leverCached: lever.value.leverCached,
    },
  };
}

/** `Server-Timing` header value for a prefill response (visible in DevTools). */
export function prefillServerTiming(t: PrefillTimings): string {
  return [
    `db;dur=${t.dbMs}`,
    `lever;dur=${t.leverExistingMs};desc="${t.leverCached ? 'cached' : 'live'}"`,
    `postings;dur=${t.postingsMs}`,
    `total;dur=${t.totalMs}`,
  ].join(', ');
}

const GEM_PREFILL_OUTCOME: Record<GemLookupStatus, string> = {
  FOUND: 'found',
  NOT_FOUND: 'not_found',
  NOT_CONNECTED: 'not_connected',
  NEEDS_REAUTH: 'needs_reauth',
  UNAVAILABLE: 'error',
};

/**
 * Gem lookup for a prefill, with one GEM_PREFILL SystemLog row per attempt
 * so a "Gem didn't fill anything" report can be diagnosed. Outcome, source,
 * step timings and which fields came back only — never the values
 * (candidate PII).
 */
async function timedGemLookup(userId: string, email: string, extId: string | null): Promise<GemLookup> {
  const t0 = Date.now();
  const gem = await addToLeverDeps.gemLookup(userId, email, { extId }).catch((): GemLookup => ({ status: 'UNAVAILABLE' }));
  const p = gem.status === 'FOUND' ? gem.person : undefined;
  await logEvent(
    'GEM_PREFILL',
    {
      userId,
      outcome: GEM_PREFILL_OUTCOME[gem.status],
      source: 'live',
      durationMs: Date.now() - t0,
      ...gem.timings,
      ...(p && { fields: { linkedin: !!p.linkedinUrl, title: !!p.title, location: !!p.location, resume: !!p.resume } }),
    },
    gem.status === 'UNAVAILABLE' ? 'WARN' : 'INFO'
  );
  return gem;
}

function gemPrefillFromCache(
  c: CandidateForPrefill,
  connection: 'NOT_CONNECTED' | 'PENDING' | 'OK' | 'NEEDS_REAUTH',
  source: GemPrefillSource
): LeverGemPrefill {
  const connected = connection === 'OK';
  const status: GemLookupStatus = connected
    ? c.gemPersonId
      ? 'FOUND'
      : 'NOT_FOUND'
    : connection === 'NEEDS_REAUTH'
      ? 'NEEDS_REAUTH'
      : 'NOT_CONNECTED';
  return {
    status,
    source,
    fetchedAt: c.gemFetchedAt ? new Date(c.gemFetchedAt).toISOString() : null,
    name: null,
    headline: buildHeadline(c.gemTitle, c.gemCompany),
    location: c.gemLocation ?? null,
    phone: null,
    linkedinUrl: c.gemPersonId ? normalizeLinkedinUrl(c.linkedinUrl) : null,
    // The résumé itself is fetched at create time with the clicker's own Gem connection.
    resume: { available: connected && !!c.gemResumeAvailable, source: null, filename: null },
  };
}

/**
 * Gem enrichment for the dialog. Known candidate: the gem* cache when
 * fresh (FOUND < 7 days, NOT_FOUND < 24h), the stale cache plus a
 * background refresh when older, else a live lookup that fills the cache.
 * Unknown email: always live, nothing stored.
 */
export async function buildGemPrefill(args: {
  actorUserId: string;
  email: string;
  candidate: CandidateForPrefill | null;
}): Promise<LeverGemPrefill> {
  const email = args.email.trim().toLowerCase();
  const c = args.candidate;
  const state = c ? gemCacheState({ gemPersonId: c.gemPersonId ?? null, gemFetchedAt: c.gemFetchedAt ?? null }) : 'missing';
  if (c && state !== 'missing') {
    const t0 = Date.now();
    const { status: connection } = await gemConnectionStatus(args.actorUserId);
    const source: GemPrefillSource = state === 'fresh' ? 'cache' : 'cache_stale';
    if (state === 'stale' && connection === 'OK') scheduleGemEnrichment(c.id, 'stale', { userId: args.actorUserId });
    const out = gemPrefillFromCache(c, connection, source);
    await logEvent(
      'GEM_PREFILL',
      { userId: args.actorUserId, outcome: GEM_PREFILL_OUTCOME[out.status], source, durationMs: Date.now() - t0 },
      'INFO'
    );
    return out;
  }

  const gem = await timedGemLookup(args.actorUserId, email, c?.gemPersonId ?? null);
  if (c) {
    try {
      await persistGemEnrichment(c.id, gem);
    } catch (err) {
      console.warn('[AddToLever] Gem cache write failed:', safeError(err).message);
    }
  }
  const person = gem.status === 'FOUND' ? gem.person : undefined;
  return {
    status: gem.status,
    ...(gem.message && { message: gem.message }),
    source: 'live',
    fetchedAt: new Date().toISOString(),
    name: person?.name ?? null,
    headline: buildHeadline(person?.title, person?.company),
    location: person?.location ?? null,
    phone: person?.phone ?? null,
    linkedinUrl: person?.linkedinUrl ?? null,
    resume: {
      available: !!person?.resume,
      source: person?.resume?.source ?? null,
      filename: person?.resume?.filename ?? null,
    },
  };
}

// ── Create ─────────────────────────────────────────────────────────────────

const optionalText = (max: number) => z.string().trim().max(max).nullish();

/** Body of POST /api/candidates/:id/lever and POST /api/lookup/lever (+ email). */
export const createRequestSchema = z.object({
  name: z.string().trim().min(1, 'name is required').max(200),
  headline: optionalText(300),
  location: optionalText(200),
  phone: optionalText(50),
  linkedinUrl: optionalText(500).refine((v) => !v || normalizeLinkedinUrl(v) !== null, {
    message: 'linkedinUrl must be a linkedin.com URL',
  }),
  postingId: z.string().trim().min(1, 'postingId is required').max(100),
  stageId: z.string().trim().min(1).max(100).nullish(),
  tags: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
  sources: z.array(z.string().trim().min(1).max(100)).max(10).default([]),
  note: z.string().max(5000).nullish(),
  includeResume: z.boolean().default(true),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{16,100}$/, 'idempotencyKey must be 16-100 url-safe chars'),
});

export type CreateRequest = z.infer<typeof createRequestSchema>;

export interface CreateResult {
  opportunityId: string;
  leverUrl: string;
  postingId: string;
  postingTitle: string | null;
  stageName: string | null;
  resumeAttached: boolean;
  noteAdded: boolean;
  duplicateRequest?: boolean;
  candidate?: unknown;
}

const RESUME_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

/** Downloads Gem's résumé into memory for the create; null on any problem. */
async function fetchResume(url: string, filename: string): Promise<LeverResumeFile | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RESUME_TIMEOUT_MS);
  try {
    if (!url.startsWith('https://')) return null;
    const res = await addToLeverDeps.fetchFn(url, { signal: controller.signal });
    if (!res.ok) return null;
    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_RESUME_BYTES) return null;
    const ext = filename.toLowerCase().split('.').pop() ?? '';
    let contentType = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
    if (contentType === 'application/octet-stream' || contentType === 'binary/octet-stream' || !contentType) {
      contentType = RESUME_TYPES[ext] ?? '';
    }
    if (!Object.values(RESUME_TYPES).includes(contentType)) return null;
    const data = new Uint8Array(await res.arrayBuffer());
    if (data.byteLength === 0 || data.byteLength > MAX_RESUME_BYTES) return null;
    return { filename, contentType, data };
  } catch (err) {
    console.warn('[AddToLever] résumé download failed:', safeError(err).message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function recentCreateFromLog(idempotencyKey: string): Promise<CreateResult | null> {
  const row = await prisma.systemLog.findFirst({
    where: {
      event: 'LEVER_OPPORTUNITY_CREATED',
      createdAt: { gte: new Date(Date.now() - IDEMPOTENCY_TTL_MS) },
      details: { contains: `"idempotencyKey":"${idempotencyKey}"` },
    },
    select: { details: true },
    orderBy: { createdAt: 'desc' },
  });
  if (!row) return null;
  try {
    const d = JSON.parse(row.details) as { opportunityId?: string; postingId?: string };
    if (!d.opportunityId) return null;
    return {
      opportunityId: d.opportunityId,
      leverUrl: leverOpportunityUrl(d.opportunityId),
      postingId: d.postingId ?? '',
      postingTitle: null,
      stageName: null,
      resumeAttached: false,
      noteAdded: false,
      duplicateRequest: true,
    };
  } catch {
    return null;
  }
}

async function doCreate(args: {
  actorUserId: string;
  email: string;
  candidateId: string | null;
  gemPersonId?: string | null;
  req: CreateRequest;
}): Promise<CreateResult> {
  const { req } = args;
  const email = args.email.trim().toLowerCase();
  const writer = writerOrThrow();

  const fromLog = await recentCreateFromLog(req.idempotencyKey);
  if (fromLog) return fromLog;

  const actor = await actorEmail(args.actorUserId);
  if (!actor) throw new AddToLeverError(401, 'Unknown user');
  const leverUser = await leverUserFor(actor);
  if (!leverUser) throw new AddToLeverError(409, `Your Lever account wasn't found for ${actor}`);

  let posting = (await getOpenPostings()).find((p) => p.id === req.postingId);
  if (!posting) posting = (await getOpenPostings({ force: true })).find((p) => p.id === req.postingId);
  if (!posting) throw new AddToLeverError(400, 'That job is no longer open in Lever');

  const stages = await getStages();
  let stage: LeverStage | null;
  if (req.stageId) {
    stage = stages.find((s) => s.id === req.stageId) ?? null;
    if (!stage) throw new AddToLeverError(400, 'Unknown Lever stage');
  } else {
    stage = defaultStage(stages);
  }

  const status = await addToLeverDeps.reader().findByEmail(email);
  if (status.state === 'ERROR') {
    throw new AddToLeverError(502, "Couldn't check Lever for an existing opportunity — try again in a minute.");
  }
  const dup = status.opportunities.find((o) => o.postingId === posting!.id);
  if (dup) {
    throw new AddToLeverError(409, `${email} is already in Lever for ${posting.title}`, {
      existing: { id: dup.id, leverUrl: dup.leverUrl, postingTitle: dup.postingTitle ?? posting.title },
    });
  }

  let resume: LeverResumeFile | null = null;
  if (req.includeResume) {
    const gem = await addToLeverDeps
      .gemLookup(args.actorUserId, email, { extId: args.gemPersonId ?? null })
      .catch((): GemLookup => ({ status: 'UNAVAILABLE' }));
    if (gem.status === 'FOUND' && gem.person?.resume) {
      resume = await fetchResume(gem.person.resume.url, gem.person.resume.filename);
    }
  }

  const linkedinUrl = req.linkedinUrl ? normalizeLinkedinUrl(req.linkedinUrl) : null;
  const { id: opportunityId } = await writer.createOpportunity(
    {
      name: req.name,
      headline: req.headline ?? null,
      location: req.location ?? null,
      email,
      phone: req.phone ?? null,
      links: linkedinUrl ? [linkedinUrl] : [],
      tags: req.tags,
      sources: req.sources,
      stageId: stage?.id ?? null,
      postingId: posting.id,
      resume,
    },
    leverUser.id
  );

  // Logged before anything else can fail: this row is the cross-instance
  // idempotency record. Ids only — no candidate PII.
  await logEvent(
    'LEVER_OPPORTUNITY_CREATED',
    {
      actorUserId: args.actorUserId,
      candidateId: args.candidateId,
      opportunityId,
      postingId: posting.id,
      idempotencyKey: req.idempotencyKey,
    },
    'INFO'
  );

  let noteAdded = false;
  if (req.note?.trim()) {
    try {
      await writer.addNote(opportunityId, req.note.trim(), leverUser.id);
      noteAdded = true;
    } catch (err) {
      console.warn('[AddToLever] note failed:', safeError(err).message);
    }
  }

  let candidate: unknown;
  if (args.candidateId) {
    try {
      if (linkedinUrl) {
        await prisma.candidate.update({ where: { id: args.candidateId }, data: { linkedinUrl } });
      }
      const refreshed = await refreshCandidateLever(args.candidateId, addToLeverDeps.reader());
      candidate = refreshed?.candidate;
    } catch (err) {
      console.warn('[AddToLever] post-create refresh failed:', safeError(err).message);
    }
  }

  return {
    opportunityId,
    leverUrl: leverOpportunityUrl(opportunityId),
    postingId: posting.id,
    postingTitle: posting.title,
    stageName: stage?.text ?? null,
    resumeAttached: !!resume,
    noteAdded,
    ...(candidate !== undefined && { candidate }),
  };
}

/** Creates (or returns the in-flight/recent result for the same key). */
export async function createInLever(args: {
  actorUserId: string;
  email: string;
  candidateId: string | null;
  /** Cached Candidate.gemPersonId: the résumé lookup skips Gem's search. */
  gemPersonId?: string | null;
  req: CreateRequest;
}): Promise<CreateResult> {
  if (!isLeverCreateEnabled()) throw new AddToLeverError(403, 'Add to Lever is turned off');

  const now = Date.now();
  for (const [k, v] of inflight) if (now - v.at > IDEMPOTENCY_TTL_MS) inflight.delete(k);

  const key = `${args.actorUserId}:${args.req.idempotencyKey}`;
  const existing = inflight.get(key);
  if (existing) return existing.promise;

  const promise = doCreate(args);
  inflight.set(key, { at: now, promise });
  try {
    return await promise;
  } catch (err) {
    // A failed attempt doesn't hold the key: the recruiter can fix and retry.
    inflight.delete(key);
    throw err;
  }
}

/** Maps a create/prefill failure to an HTTP status + body (never 401 for Lever's own auth). */
export function toHttpError(err: unknown): { status: number; body: Record<string, unknown> } | null {
  if (err instanceof AddToLeverError) {
    return { status: err.status, body: { success: false, error: err.message, ...err.extra } };
  }
  if (err instanceof LeverWriteError) {
    const status = err.status >= 400 && err.status < 500 && err.status !== 401 && err.status !== 403 && err.status !== 429 ? 422 : 502;
    return { status, body: { success: false, error: err.message } };
  }
  return null;
}
