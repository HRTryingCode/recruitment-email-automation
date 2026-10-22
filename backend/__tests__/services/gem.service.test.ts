import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { buildPrismaMock, resetPrismaMock, type MockPrisma } from '../_setup/mockPrisma';

vi.mock('../../src/db/client', () => {
  const prisma = buildPrismaMock();
  return { prisma, default: prisma };
});

import { prisma as injected } from '../../src/db/client';
import { encrypt, decrypt } from '../../src/lib/crypto';
import {
  buildGemAuthUrl,
  completeGemAuth,
  getGemAccessToken,
  lookupGemPerson,
  parseGemPerson,
  gemConnectionStatus,
  gemRedirectUri,
  __resetGemDiscoveryCache,
  __resetGemClientCache,
} from '../../src/services/gem.service';

const mockPrisma = injected as unknown as MockPrisma;
const USER = 'ckuser000000000000000001';

// ── Fake Gem OAuth server (fetch) — no request leaves the process ─────────
function fakeAuthFetch(opts: { tokenStatus?: number; omitRefreshToken?: boolean } = {}) {
  const calls: Array<{ url: string; method: string; body: string }> = [];
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
  const fn = vi.fn(async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const body = init.body ? String(init.body) : '';
    calls.push({ url: url.toString(), method: init.method ?? 'GET', body });
    if (url.host === 'mcp.gem.com' && url.pathname === '/.well-known/oauth-protected-resource') {
      return json({ resource: 'https://mcp.gem.com/mcp', authorization_servers: ['https://auth.gem.test'] });
    }
    if (url.host === 'auth.gem.test' && url.pathname === '/.well-known/oauth-authorization-server') {
      return json({
        issuer: 'https://auth.gem.test',
        authorization_endpoint: 'https://auth.gem.test/oauth/mcp/authorize',
        token_endpoint: 'https://auth.gem.test/oauth/mcp/token',
        registration_endpoint: 'https://auth.gem.test/oauth/mcp/register',
        response_types_supported: ['code'],
        code_challenge_methods_supported: ['S256'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        token_endpoint_auth_methods_supported: ['none'],
      });
    }
    if (url.pathname === '/oauth/mcp/register') {
      const meta = JSON.parse(body);
      return json({ ...meta, client_id: 'gem-client-1' }, 201);
    }
    if (url.pathname === '/oauth/mcp/token') {
      if (opts.tokenStatus && opts.tokenStatus >= 400) return json({ error: 'invalid_grant' }, opts.tokenStatus);
      return json({
        access_token: 'at-new',
        ...(!opts.omitRefreshToken && { refresh_token: 'rt-new' }),
        token_type: 'Bearer',
        expires_in: 3600,
      });
    }
    return json({ detail: 'Not Found' }, 404);
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

// ── In-process fake GeMCP server ──────────────────────────────────────────
type ToolImpl = (args: Record<string, unknown>) => unknown | Promise<unknown>;
function fakeGemMcp(tools: Record<string, ToolImpl>) {
  const seen: Array<{ name: string; args: Record<string, unknown> }> = [];
  const factory = (_token?: string) => {
    const server = new Server({ name: 'fake-gem', version: '0.0.0' }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: Object.keys(tools).map((name) => ({ name, inputSchema: { type: 'object' as const } })),
    }));
    server.setRequestHandler(CallToolRequestSchema, async (req) => {
      const args = (req.params.arguments ?? {}) as Record<string, unknown>;
      seen.push({ name: req.params.name, args });
      const out = await tools[req.params.name]!(args);
      return { content: [{ type: 'text' as const, text: typeof out === 'string' ? out : JSON.stringify(out) }] };
    });
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    void server.connect(serverT);
    return clientT;
  };
  return { factory, seen };
}

const PERSON = {
  found: true,
  entity: {
    ext_id: 'g-1',
    display_name: 'Jane Doe',
    title: 'Staff Engineer',
    company: 'Acme',
    location: 'Berlin, Germany',
    emails: [{ email_address: 'jane@example.com' }],
    phone_numbers: [{ number: '+49 30 1234' }],
    linkedin_url: 'https://www.linkedin.com/in/jane',
    resumes: [
      { url: 'https://s3.gem.test/r1.pdf?sig=x', file_name: 'Jane_LinkedIn.pdf', source: 'LinkedIn PDF' },
      { url: 'https://s3.gem.test/r0.pdf?sig=y', file_name: 'old.pdf', source: 'Upload' },
    ],
  },
};

function okConnection(extra: Record<string, unknown> = {}) {
  return {
    userId: USER,
    status: 'OK',
    tokens: encrypt(JSON.stringify({ access_token: 'at-1', refresh_token: 'rt-1', token_type: 'Bearer' })),
    expiresAt: new Date(Date.now() + 3600_000),
    clientRegistration: { client_id: 'gem-client-1', redirect_uris: [gemRedirectUri()] },
    ...extra,
  };
}

beforeEach(() => {
  resetPrismaMock(mockPrisma);
  __resetGemDiscoveryCache();
  __resetGemClientCache();
  mockPrisma.gemConnection.upsert.mockResolvedValue({});
  mockPrisma.gemConnection.update.mockResolvedValue({});
  mockPrisma.gemConnection.updateMany.mockResolvedValue({ count: 1 });
});

describe('Gem OAuth (MCP OAuth 2.1: discovery + DCR + PKCE)', () => {
  it('buildGemAuthUrl registers a public client, binds state to the user and stores the PKCE verifier encrypted', async () => {
    mockPrisma.gemConnection.findUnique.mockResolvedValueOnce(null);
    const f = fakeAuthFetch();
    const url = new URL(await buildGemAuthUrl(USER, { fetchFn: f.fn }));

    expect(url.origin + url.pathname).toBe('https://auth.gem.test/oauth/mcp/authorize');
    expect(url.searchParams.get('client_id')).toBe('gem-client-1');
    expect(url.searchParams.get('redirect_uri')).toBe(gemRedirectUri());
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('state')).toMatch(new RegExp(`^gem-[0-9a-f]{64}\\.${USER}$`));
    expect(url.searchParams.get('resource')).toBe('https://mcp.gem.com/mcp');

    const reg = f.calls.find((c) => c.url.endsWith('/oauth/mcp/register'))!;
    const regBody = JSON.parse(reg.body);
    expect(regBody.redirect_uris).toEqual([gemRedirectUri()]);
    expect(regBody.token_endpoint_auth_method).toBe('none');

    const saved = mockPrisma.gemConnection.upsert.mock.calls[0]![0];
    expect(saved.where).toEqual({ userId: USER });
    expect(saved.create.clientRegistration.client_id).toBe('gem-client-1');
    expect(saved.create.pendingVerifier).not.toMatch(/^[A-Za-z0-9_-]{43,128}$/); // encrypted, not raw
    expect(decrypt(saved.create.pendingVerifier)).toMatch(/^[A-Za-z0-9._~-]{43,128}$/);
  });

  it('reuses an existing client registration for the same redirect URI', async () => {
    mockPrisma.gemConnection.findUnique.mockResolvedValueOnce(okConnection());
    const f = fakeAuthFetch();
    await buildGemAuthUrl(USER, { fetchFn: f.fn });
    expect(f.calls.some((c) => c.url.endsWith('/register'))).toBe(false);
  });

  it('completeGemAuth exchanges the code with the stored verifier and stores tokens encrypted, status OK', async () => {
    mockPrisma.gemConnection.findUnique.mockResolvedValueOnce({
      ...okConnection({ status: 'PENDING', tokens: null }),
      pendingVerifier: encrypt('v'.repeat(50)),
    });
    const f = fakeAuthFetch();
    await completeGemAuth(USER, 'the-code', { fetchFn: f.fn });

    const tokenCall = f.calls.find((c) => c.url.endsWith('/oauth/mcp/token'))!;
    const params = new URLSearchParams(tokenCall.body);
    expect(params.get('grant_type')).toBe('authorization_code');
    expect(params.get('code')).toBe('the-code');
    expect(params.get('code_verifier')).toBe('v'.repeat(50));
    expect(params.get('client_id')).toBe('gem-client-1');

    const upd = mockPrisma.gemConnection.update.mock.calls[0]![0];
    expect(upd.data.status).toBe('OK');
    expect(upd.data.pendingVerifier).toBeNull();
    expect(upd.data.tokens).not.toContain('at-new');
    expect(JSON.parse(decrypt(upd.data.tokens)).access_token).toBe('at-new');
    expect(upd.data.expiresAt.getTime()).toBeGreaterThan(Date.now() + 3500_000);
  });

  it('completeGemAuth without a pending authorize fails cleanly', async () => {
    mockPrisma.gemConnection.findUnique.mockResolvedValueOnce(null);
    await expect(completeGemAuth(USER, 'c', { fetchFn: fakeAuthFetch().fn })).rejects.toThrow(/no pending/i);
  });
});

describe('getGemAccessToken', () => {
  it('returns the stored token when not expiring', async () => {
    mockPrisma.gemConnection.findUnique.mockResolvedValueOnce(okConnection());
    expect(await getGemAccessToken(USER, { fetchFn: fakeAuthFetch().fn })).toEqual({ ok: true, token: 'at-1' });
  });

  it('NOT_CONNECTED without a row', async () => {
    mockPrisma.gemConnection.findUnique.mockResolvedValueOnce(null);
    expect(await getGemAccessToken(USER)).toEqual({ ok: false, status: 'NOT_CONNECTED' });
  });

  it('refreshes an expiring token and persists the new one', async () => {
    mockPrisma.gemConnection.findUnique.mockResolvedValueOnce(okConnection({ expiresAt: new Date(Date.now() + 10_000) }));
    const f = fakeAuthFetch();
    expect(await getGemAccessToken(USER, { fetchFn: f.fn })).toEqual({ ok: true, token: 'at-new' });
    const params = new URLSearchParams(f.calls.find((c) => c.url.endsWith('/token'))!.body);
    expect(params.get('grant_type')).toBe('refresh_token');
    expect(params.get('refresh_token')).toBe('rt-1');
    const upd = mockPrisma.gemConnection.update.mock.calls[0]![0];
    expect(JSON.parse(decrypt(upd.data.tokens)).access_token).toBe('at-new');
  });

  it('refresh failure flips the connection to NEEDS_REAUTH (once) and logs without tokens', async () => {
    mockPrisma.gemConnection.findUnique.mockResolvedValueOnce(okConnection({ expiresAt: new Date(Date.now() - 1000) }));
    const out = await getGemAccessToken(USER, { fetchFn: fakeAuthFetch({ tokenStatus: 400 }).fn });
    expect(out).toEqual({ ok: false, status: 'NEEDS_REAUTH' });
    const flip = mockPrisma.gemConnection.updateMany.mock.calls[0]![0];
    expect(flip.where).toEqual({ userId: USER, status: { not: 'NEEDS_REAUTH' } });
    expect(flip.data.status).toBe('NEEDS_REAUTH');
    const log = mockPrisma.systemLog.create.mock.calls.find((c) => c[0].data.event === 'GEM_AUTH_REVOKED')!;
    expect(log[0].data.details).not.toMatch(/rt-1|at-1/);
  });

  it('keeps the old refresh token when Gem does not rotate it on refresh', async () => {
    mockPrisma.gemConnection.findUnique.mockResolvedValueOnce(okConnection({ expiresAt: new Date(Date.now() - 1000) }));
    const f = fakeAuthFetch({ omitRefreshToken: true });
    expect(await getGemAccessToken(USER, { fetchFn: f.fn })).toEqual({ ok: true, token: 'at-new' });
    const upd = mockPrisma.gemConnection.update.mock.calls[0]![0];
    expect(JSON.parse(decrypt(upd.data.tokens)).refresh_token).toBe('rt-1');
  });

  it('a NEEDS_REAUTH row fails fast', async () => {
    mockPrisma.gemConnection.findUnique.mockResolvedValueOnce(okConnection({ status: 'NEEDS_REAUTH' }));
    expect(await getGemAccessToken(USER)).toEqual({ ok: false, status: 'NEEDS_REAUTH' });
  });
});

describe('lookupGemPerson (fake GeMCP server)', () => {
  it('search → get_person, read-only tools only, mapped to GemPerson', async () => {
    mockPrisma.gemConnection.findUnique.mockResolvedValueOnce(okConnection());
    const gem = fakeGemMcp({
      search: () => ({ kind: 'person', query: 'jane@example.com', results: [{ ext_id: 'g-1', display_name: 'Jane Doe' }] }),
      get_person: () => PERSON,
    });
    const out = await lookupGemPerson(USER, 'jane@example.com', { transportFactory: gem.factory });
    expect(out.status).toBe('FOUND');
    expect(out.person).toEqual({
      id: 'g-1',
      name: 'Jane Doe',
      title: 'Staff Engineer',
      company: 'Acme',
      location: 'Berlin, Germany',
      phone: '+49 30 1234',
      linkedinUrl: 'https://www.linkedin.com/in/jane',
      resume: { url: 'https://s3.gem.test/r1.pdf?sig=x', filename: 'Jane_LinkedIn.pdf', source: 'LinkedIn PDF' },
    });
    expect(gem.seen.map((s) => s.name)).toEqual(['search', 'get_person']);
    expect(gem.seen[0]!.args).toEqual({ kind: 'person', query: 'jane@example.com', max_results: 5 });
    expect(gem.seen[1]!.args).toEqual({ ext_id: 'g-1', fields: ['work_history', 'resumes'] });
  });

  it('NOT_FOUND when search has no results', async () => {
    mockPrisma.gemConnection.findUnique.mockResolvedValueOnce(okConnection());
    const gem = fakeGemMcp({ search: () => ({ results: [] }), get_person: () => PERSON });
    expect((await lookupGemPerson(USER, 'x@y.com', { transportFactory: gem.factory })).status).toBe('NOT_FOUND');
  });

  it('a changed tool shape degrades to UNAVAILABLE with the manual-LinkedIn message', async () => {
    mockPrisma.gemConnection.findUnique.mockResolvedValueOnce(okConnection());
    const gem = fakeGemMcp({ search: () => 'totally not json', get_person: () => PERSON });
    const out = await lookupGemPerson(USER, 'x@y.com', { transportFactory: gem.factory });
    expect(out).toMatchObject({ status: 'UNAVAILABLE', message: 'Gem unavailable — paste LinkedIn manually' });
  });

  it('a get_person with found:false or garbage entity is NOT_FOUND / UNAVAILABLE, never throws', async () => {
    mockPrisma.gemConnection.findUnique.mockResolvedValue(okConnection());
    const notFound = fakeGemMcp({ search: () => ({ results: [{ ext_id: 'g' }] }), get_person: () => ({ found: false }) });
    expect((await lookupGemPerson(USER, 'x@y.com', { transportFactory: notFound.factory })).status).toBe('NOT_FOUND');
    __resetGemClientCache(); // a different fake server behind the same token
    const garbage = fakeGemMcp({ search: () => ({ results: [{ ext_id: 'g' }] }), get_person: () => ({ found: true, entity: 42 }) });
    expect((await lookupGemPerson(USER, 'x@y.com', { transportFactory: garbage.factory })).status).toBe('UNAVAILABLE');
  });

  it('times out at the configured limit and degrades', async () => {
    mockPrisma.gemConnection.findUnique.mockResolvedValueOnce(okConnection());
    const gem = fakeGemMcp({ search: () => new Promise(() => {}), get_person: () => PERSON });
    const t0 = Date.now();
    const out = await lookupGemPerson(USER, 'x@y.com', { transportFactory: gem.factory, timeoutMs: 50 });
    expect(out.status).toBe('UNAVAILABLE');
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it('NOT_CONNECTED / NEEDS_REAUTH pass through without calling Gem', async () => {
    const gem = fakeGemMcp({ search: () => ({ results: [] }), get_person: () => PERSON });
    mockPrisma.gemConnection.findUnique.mockResolvedValueOnce(null);
    expect((await lookupGemPerson(USER, 'x@y.com', { transportFactory: gem.factory })).status).toBe('NOT_CONNECTED');
    mockPrisma.gemConnection.findUnique.mockResolvedValueOnce(okConnection({ status: 'NEEDS_REAUTH' }));
    expect((await lookupGemPerson(USER, 'x@y.com', { transportFactory: gem.factory })).status).toBe('NEEDS_REAUTH');
    expect(gem.seen).toEqual([]);
  });

  it('an expired access token (Gem issues 5-minute tokens) is refreshed before the MCP call, which then succeeds', async () => {
    mockPrisma.gemConnection.findUnique.mockResolvedValueOnce(okConnection({ expiresAt: new Date(Date.now() - 60_000) }));
    const f = fakeAuthFetch();
    const gem = fakeGemMcp({ search: () => ({ results: [{ ext_id: 'g-1' }] }), get_person: () => PERSON });
    const tokensUsed: string[] = [];
    const out = await lookupGemPerson(USER, 'jane@example.com', {
      fetchFn: f.fn,
      transportFactory: (token) => {
        tokensUsed.push(token);
        return gem.factory();
      },
    });
    expect(out.status).toBe('FOUND');
    expect(tokensUsed).toEqual(['at-new']);
    expect(f.calls.some((c) => c.url.endsWith('/token'))).toBe(true);
  });

  it('an expired token whose refresh fails → NEEDS_REAUTH, Gem MCP never called', async () => {
    mockPrisma.gemConnection.findUnique.mockResolvedValueOnce(okConnection({ expiresAt: new Date(Date.now() - 60_000) }));
    const gem = fakeGemMcp({ search: () => ({ results: [] }), get_person: () => PERSON });
    const out = await lookupGemPerson(USER, 'jane@example.com', {
      fetchFn: fakeAuthFetch({ tokenStatus: 400 }).fn,
      transportFactory: gem.factory,
    });
    expect(out).toMatchObject({ status: 'NEEDS_REAUTH' });
    expect(gem.seen).toEqual([]);
    expect(mockPrisma.gemConnection.updateMany.mock.calls[0]![0].data.status).toBe('NEEDS_REAUTH');
  });

  it('a search that matched a different person by name is ignored (email must match when emails are present)', async () => {
    mockPrisma.gemConnection.findUnique.mockResolvedValueOnce(okConnection());
    const gem = fakeGemMcp({
      search: () => ({ results: [{ ext_id: 'g-1' }] }),
      get_person: () => ({ ...PERSON, entity: { ...PERSON.entity, emails: [{ email_address: 'other@example.com' }] } }),
    });
    expect((await lookupGemPerson(USER, 'jane@example.com', { transportFactory: gem.factory })).status).toBe('NOT_FOUND');
  });
});

describe('lookupGemPerson speed (H5)', () => {
  it('reports per-step timings; the first lookup on an instance is cold', async () => {
    mockPrisma.gemConnection.findUnique.mockResolvedValue(okConnection());
    const gem = fakeGemMcp({ search: () => ({ results: [{ ext_id: 'g-1' }] }), get_person: () => PERSON });
    const first = await lookupGemPerson(USER, 'jane@example.com', { transportFactory: gem.factory });
    expect(first.timings).toMatchObject({ cold: true, clientReused: false, authRefreshMs: 0 });
    for (const k of ['authMs', 'mcpConnectMs', 'searchMs', 'getPersonMs', 'totalMs'] as const) {
      expect(typeof first.timings![k]).toBe('number');
    }
    const second = await lookupGemPerson(USER, 'jane@example.com', { transportFactory: gem.factory });
    expect(second.timings).toMatchObject({ cold: false, clientReused: true, mcpConnectMs: 0 });
  });

  it('reuses the MCP client for the same user + token (one connect for two lookups)', async () => {
    mockPrisma.gemConnection.findUnique.mockResolvedValue(okConnection());
    const gem = fakeGemMcp({ search: () => ({ results: [{ ext_id: 'g-1' }] }), get_person: () => PERSON });
    const factory = vi.fn((token: string) => gem.factory(token));
    await lookupGemPerson(USER, 'jane@example.com', { transportFactory: factory });
    await lookupGemPerson(USER, 'jane@example.com', { transportFactory: factory });
    expect(factory).toHaveBeenCalledTimes(1);
    expect(gem.seen.map((s) => s.name)).toEqual(['search', 'get_person', 'search', 'get_person']);
  });

  it('a new access token opens a new client', async () => {
    const gem = fakeGemMcp({ search: () => ({ results: [] }), get_person: () => PERSON });
    const factory = vi.fn((token: string) => gem.factory(token));
    mockPrisma.gemConnection.findUnique.mockResolvedValueOnce(okConnection());
    await lookupGemPerson(USER, 'a@b.com', { transportFactory: factory });
    mockPrisma.gemConnection.findUnique.mockResolvedValueOnce(
      okConnection({ tokens: encrypt(JSON.stringify({ access_token: 'at-2', refresh_token: 'rt-1', token_type: 'Bearer' })) })
    );
    await lookupGemPerson(USER, 'a@b.com', { transportFactory: factory });
    expect(factory.mock.calls.map((c) => c[0])).toEqual(['at-1', 'at-2']);
  });

  it('a failed lookup evicts the cached client so the next one reconnects', async () => {
    mockPrisma.gemConnection.findUnique.mockResolvedValue(okConnection());
    let fail = true;
    const gem = fakeGemMcp({
      search: () => {
        if (fail) throw new Error('session gone');
        return { results: [] };
      },
      get_person: () => PERSON,
    });
    const factory = vi.fn((token: string) => gem.factory(token));
    expect((await lookupGemPerson(USER, 'a@b.com', { transportFactory: factory })).status).toBe('UNAVAILABLE');
    fail = false;
    expect((await lookupGemPerson(USER, 'a@b.com', { transportFactory: factory })).status).toBe('NOT_FOUND');
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('refreshes proactively when the token has < 60s left (not yet expired)', async () => {
    mockPrisma.gemConnection.findUnique.mockResolvedValueOnce(okConnection({ expiresAt: new Date(Date.now() + 30_000) }));
    const f = fakeAuthFetch();
    const token = await getGemAccessToken(USER, { fetchFn: f.fn });
    expect(token).toEqual({ ok: true, token: 'at-new' });
    expect(f.calls.filter((c) => c.url.endsWith('/token'))).toHaveLength(1);
  });

  it('concurrent lookups with an expiring token share one refresh (Gem rotates refresh tokens)', async () => {
    mockPrisma.gemConnection.findUnique.mockResolvedValue(okConnection({ expiresAt: new Date(Date.now() - 1000) }));
    const f = fakeAuthFetch();
    const gem = fakeGemMcp({ search: () => ({ results: [] }), get_person: () => PERSON });
    const outs = await Promise.all([
      lookupGemPerson(USER, 'a@b.com', { fetchFn: f.fn, transportFactory: gem.factory }),
      lookupGemPerson(USER, 'a@b.com', { fetchFn: f.fn, transportFactory: gem.factory }),
    ]);
    expect(outs.map((o) => o.status)).toEqual(['NOT_FOUND', 'NOT_FOUND']);
    expect(f.calls.filter((c) => c.url.endsWith('/token'))).toHaveLength(1);
    expect(mockPrisma.gemConnection.updateMany).not.toHaveBeenCalled();
  });

  it('runs get_person for the top results in parallel and keeps search order', async () => {
    mockPrisma.gemConnection.findUnique.mockResolvedValue(okConnection());
    let inFlight = 0;
    let maxInFlight = 0;
    const gem = fakeGemMcp({
      search: () => ({ results: [{ ext_id: 'g-a' }, { ext_id: 'g-b' }, { ext_id: 'g-c' }] }),
      get_person: async (args) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 30));
        inFlight -= 1;
        const id = String(args.ext_id);
        const emails = id === 'g-a' ? [{ email_address: 'someone@else.com' }] : PERSON.entity.emails;
        return { ...PERSON, entity: { ...PERSON.entity, ext_id: id, display_name: id, emails } };
      },
    });
    const out = await lookupGemPerson(USER, 'jane@example.com', { transportFactory: gem.factory });
    expect(maxInFlight).toBe(3);
    expect(out.person).toMatchObject({ id: 'g-b', name: 'g-b' });
  });

  it('a hung tool call is cut off by the per-call timeout', async () => {
    mockPrisma.gemConnection.findUnique.mockResolvedValue(okConnection());
    const gem = fakeGemMcp({ search: () => new Promise(() => {}), get_person: () => PERSON });
    const t0 = Date.now();
    const out = await lookupGemPerson(USER, 'x@y.com', { transportFactory: gem.factory, callTimeoutMs: 50 });
    expect(out.status).toBe('UNAVAILABLE');
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it('with a known Gem person id, skips search and checks the email on get_person', async () => {
    mockPrisma.gemConnection.findUnique.mockResolvedValue(okConnection());
    const gem = fakeGemMcp({ search: () => ({ results: [] }), get_person: () => PERSON });
    const out = await lookupGemPerson(USER, 'jane@example.com', { transportFactory: gem.factory, extId: 'g-1' });
    expect(out.status).toBe('FOUND');
    expect(gem.seen.map((s) => s.name)).toEqual(['get_person']);
    const other = await lookupGemPerson(USER, 'other@example.com', { transportFactory: gem.factory, extId: 'g-1' });
    expect(other.status).toBe('NOT_FOUND');
  });
});

describe('parseGemPerson (defensive)', () => {
  it('accepts string emails/phones and alternative resume keys; drops non-https résumé URLs', () => {
    const p = parseGemPerson({
      display_name: 'A B',
      emails: ['a@b.com'],
      phone_numbers: ['123'],
      resumes: [{ download_url: 'http://insecure/x.pdf', filename: 'x.pdf' }],
    });
    expect(p).toMatchObject({ name: 'A B', phone: '123', resume: null, linkedinUrl: null });
  });

  it('accepts Gem\'s scheme-less linkedin_url (prod shape) and canonicalizes it', () => {
    expect(
      parseGemPerson({ display_name: 'A', linkedin_url: 'www.linkedin.com/in/alexander-betit-0ab8302a' })?.linkedinUrl
    ).toBe('https://www.linkedin.com/in/alexander-betit-0ab8302a');
  });

  it('rejects a non-LinkedIn linkedin_url', () => {
    expect(parseGemPerson({ display_name: 'A', linkedin_url: 'javascript:alert(1)' })?.linkedinUrl).toBeNull();
  });

  it('returns null without a usable name', () => {
    expect(parseGemPerson({ title: 'x' })).toBeNull();
    expect(parseGemPerson(null)).toBeNull();
  });
});

describe('gemConnectionStatus', () => {
  it('maps rows to a status without leaking tokens', async () => {
    mockPrisma.gemConnection.findUnique.mockResolvedValueOnce(okConnection({ updatedAt: new Date('2026-10-22T10:00:00Z') }));
    const s = await gemConnectionStatus(USER);
    expect(s).toEqual({ status: 'OK', lastError: null, updatedAt: '2026-10-22T10:00:00.000Z' });
    mockPrisma.gemConnection.findUnique.mockResolvedValueOnce(null);
    expect((await gemConnectionStatus(USER)).status).toBe('NOT_CONNECTED');
  });
});
