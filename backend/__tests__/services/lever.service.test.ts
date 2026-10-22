import { describe, it, expect, vi } from 'vitest';
import { LeverClient, TokenBucket, pickPrimary, type LeverOpportunity } from '../../src/services/lever.service';

// Fake Lever: routes GET paths to canned JSON bodies. Anything else 404s.
type Handler = (url: URL) => { status: number; body?: unknown; headers?: Record<string, string> };

function fakeFetch(handler: Handler) {
  const calls: Array<{ url: URL; init?: RequestInit }> = [];
  const fn = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    const r = handler(url);
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), {
      status: r.status,
      headers: { 'content-type': 'application/json', ...(r.headers ?? {}) },
    });
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

const T0 = Date.UTC(2026, 9, 1);

function opp(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    stage: { id: 'st1', text: 'Interest Call' },
    archived: null,
    applications: [{ id: `app-${id}`, posting: 'post-1' }],
    createdAt: T0,
    updatedAt: T0,
    ...extra,
  };
}

function standardHandler(opps: unknown[]): Handler {
  return (url) => {
    if (url.pathname === '/v1/opportunities') return { status: 200, body: { data: opps, hasNext: false } };
    if (url.pathname === '/v1/postings/post-1') return { status: 200, body: { data: { id: 'post-1', text: 'Founding Engineer' } } };
    if (url.pathname === '/v1/postings/post-2') return { status: 200, body: { data: { id: 'post-2', text: 'Designer' } } };
    if (url.pathname === '/v1/archive_reasons')
      return {
        status: 200,
        body: {
          data: [
            { id: 'r-hired', text: 'Hired', type: 'hired' },
            { id: 'r-under', text: 'Underqualified', type: 'non-hired' },
          ],
        },
      };
    return { status: 404, body: {} };
  };
}

const noSleep = async () => {};
const unlimited = { take: async () => {} };

function client(f: typeof fetch, extra: Partial<ConstructorParameters<typeof LeverClient>[0]> = {}) {
  return new LeverClient({ apiKey: 'k', fetchImpl: f, sleep: noSleep, rateLimiter: unlimited, ...extra });
}

describe('LeverClient.findByEmail', () => {
  it('returns ERROR/unconfigured without calling Lever when no key is set', async () => {
    const { fn } = fakeFetch(() => ({ status: 200, body: {} }));
    const res = await new LeverClient({ apiKey: '', fetchImpl: fn }).findByEmail('a@b.com');
    expect(res.state).toBe('ERROR');
    expect(res.reason).toBe('unconfigured');
    expect(res.opportunities).toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });

  it('maps an active opportunity, with bearer auth, lowercased email and resolved posting', async () => {
    const { fn, calls } = fakeFetch(standardHandler([opp('o1')]));
    const res = await client(fn).findByEmail('  Arron@ArronGould.com ');
    expect(res.state).toBe('ACTIVE');
    expect(res.primary).toMatchObject({
      id: 'o1',
      postingId: 'post-1',
      postingTitle: 'Founding Engineer',
      stage: 'Interest Call',
      archivedReason: null,
      leverUrl: 'https://hire.lever.co/candidates/o1',
      createdAt: new Date(T0).toISOString(),
    });
    const oppCall = calls.find((c) => c.url.pathname === '/v1/opportunities')!;
    expect(oppCall.url.searchParams.get('email')).toBe('arron@arrongould.com');
    expect(oppCall.url.searchParams.getAll('expand')).toEqual(expect.arrayContaining(['stage', 'applications']));
    expect((oppCall.init?.headers as Record<string, string>).Authorization).toBe('Bearer k');
    expect(calls.every((c) => (c.init?.method ?? 'GET') === 'GET')).toBe(true);
  });

  it('returns NOT_FOUND for no opportunities', async () => {
    const { fn } = fakeFetch(standardHandler([]));
    const res = await client(fn).findByEmail('x@y.com');
    expect(res.state).toBe('NOT_FOUND');
    expect(res.primary).toBeNull();
  });

  it('prefers the most recently updated active opportunity over a newer archived one', async () => {
    const { fn } = fakeFetch(
      standardHandler([
        opp('old-active', { updatedAt: T0 + 1000 }),
        opp('new-active', { updatedAt: T0 + 2000, applications: [{ id: 'a', posting: 'post-2' }] }),
        opp('archived', { updatedAt: T0 + 9000, archived: { reason: 'r-under', archivedAt: T0 + 9000 } }),
      ])
    );
    const res = await client(fn).findByEmail('x@y.com');
    expect(res.state).toBe('ACTIVE');
    expect(res.primary?.id).toBe('new-active');
    expect(res.primary?.postingTitle).toBe('Designer');
    expect(res.opportunities).toHaveLength(3);
  });

  it('falls back to the most recent archived opportunity with its reason name', async () => {
    const { fn } = fakeFetch(
      standardHandler([
        opp('a1', { updatedAt: T0 + 1, archived: { reason: 'r-under', archivedAt: T0 } }),
        opp('a2', { updatedAt: T0 + 5, archived: { reason: 'r-under', archivedAt: T0 } }),
      ])
    );
    const res = await client(fn).findByEmail('x@y.com');
    expect(res.state).toBe('ARCHIVED');
    expect(res.primary?.id).toBe('a2');
    expect(res.primary?.archivedReason).toBe('Underqualified');
  });

  it('reports HIRED when the primary archived opportunity has a hired-type reason', async () => {
    const { fn } = fakeFetch(standardHandler([opp('h', { archived: { reason: 'r-hired', archivedAt: T0 } })]));
    const res = await client(fn).findByEmail('x@y.com');
    expect(res.state).toBe('HIRED');
    expect(res.primary?.archivedReason).toBe('Hired');
  });

  it('follows pagination via next/offset', async () => {
    const { fn, calls } = fakeFetch((url) => {
      if (url.pathname === '/v1/opportunities') {
        return url.searchParams.get('offset') === 'tok2'
          ? { status: 200, body: { data: [opp('p2', { updatedAt: T0 + 50 })], hasNext: false } }
          : { status: 200, body: { data: [opp('p1')], hasNext: true, next: 'tok2' } };
      }
      return standardHandler([])(url);
    });
    const res = await client(fn).findByEmail('x@y.com');
    expect(res.opportunities.map((o) => o.id)).toEqual(['p1', 'p2']);
    expect(res.primary?.id).toBe('p2');
    expect(calls.filter((c) => c.url.pathname === '/v1/opportunities')).toHaveLength(2);
  });

  it('backs off on 429 using Retry-After, then succeeds', async () => {
    let n = 0;
    const sleep = vi.fn(async () => {});
    const { fn } = fakeFetch((url) => {
      if (url.pathname === '/v1/opportunities' && n++ === 0) {
        return { status: 429, headers: { 'retry-after': '2' } };
      }
      return standardHandler([opp('o1')])(url);
    });
    const res = await client(fn, { sleep }).findByEmail('x@y.com');
    expect(res.state).toBe('ACTIVE');
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it('returns ERROR after exhausting retries on 5xx', async () => {
    const { fn } = fakeFetch(() => ({ status: 503 }));
    const res = await client(fn, { maxRetries: 2 }).findByEmail('x@y.com');
    expect(res.state).toBe('ERROR');
    expect(res.reason).toBe('http_503');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does not retry a 401 and reports it', async () => {
    const { fn } = fakeFetch(() => ({ status: 401 }));
    const res = await client(fn).findByEmail('x@y.com');
    expect(res).toMatchObject({ state: 'ERROR', reason: 'http_401' });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('keeps the opportunity when its posting lookup fails', async () => {
    const { fn } = fakeFetch((url) =>
      url.pathname.startsWith('/v1/postings') ? { status: 404 } : standardHandler([opp('o1')])(url)
    );
    const res = await client(fn).findByEmail('x@y.com');
    expect(res.state).toBe('ACTIVE');
    expect(res.primary?.postingTitle).toBeNull();
  });

  it('caches posting and archive reason lookups across calls on one client', async () => {
    const { fn, calls } = fakeFetch(
      standardHandler([opp('o1', { archived: { reason: 'r-under', archivedAt: T0 } })])
    );
    const c = client(fn);
    await c.findByEmail('a@b.com');
    await c.findByEmail('c@d.com');
    expect(calls.filter((x) => x.url.pathname === '/v1/postings/post-1')).toHaveLength(1);
    expect(calls.filter((x) => x.url.pathname === '/v1/archive_reasons')).toHaveLength(1);
  });

  it('times out a hung request and reports ERROR/timeout', async () => {
    const hang = vi.fn(
      (_: string | URL, init?: RequestInit) =>
        new Promise<Response>((_res, rej) => {
          init?.signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
        })
    ) as unknown as typeof fetch;
    const res = await client(hang, { timeoutMs: 5, maxRetries: 0 }).findByEmail('x@y.com');
    expect(res).toMatchObject({ state: 'ERROR', reason: 'timeout' });
  });
});

describe('pickPrimary', () => {
  it('returns null for an empty list', () => {
    expect(pickPrimary([])).toBeNull();
  });
  it('ignores opportunities with no updatedAt ordering issues', () => {
    const o = (id: string, archived: boolean, updatedAt: string | null): LeverOpportunity => ({
      id, archived, hired: false, postingId: null, postingTitle: null, stage: null, archivedReason: null,
      createdAt: null, updatedAt, leverUrl: '',
    });
    expect(pickPrimary([o('a', false, null), o('b', false, '2026-01-01T00:00:00.000Z')])?.id).toBe('b');
  });
});

describe('TokenBucket', () => {
  it('allows a burst up to capacity, then waits for refill', async () => {
    let now = 0;
    const sleeps: number[] = [];
    const bucket = new TokenBucket(8, 8, () => now, async (ms) => {
      sleeps.push(ms);
      now += ms;
    });
    for (let i = 0; i < 8; i++) await bucket.take();
    expect(sleeps).toEqual([]);
    await bucket.take();
    expect(sleeps.length).toBe(1);
    expect(sleeps[0]).toBeGreaterThan(0);
    expect(sleeps[0]).toBeLessThanOrEqual(125);
  });
});

describe('LeverClient.getOpportunityEmails (H2 webhooks)', () => {
  it('GETs /opportunities/:id and returns its emails lowercased', async () => {
    const f = fakeFetch((url) =>
      url.pathname === '/v1/opportunities/opp-1'
        ? { status: 200, body: { data: { id: 'opp-1', emails: ['Ada@Example.com', ' b@x.io ', 7] } } }
        : { status: 404 }
    );
    await expect(client(f.fn).getOpportunityEmails('opp-1')).resolves.toEqual(['ada@example.com', 'b@x.io']);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]!.init?.method).toBe('GET');
  });

  it('returns null for a deleted opportunity (404) or any error, never throws', async () => {
    const f = fakeFetch(() => ({ status: 404 }));
    await expect(client(f.fn).getOpportunityEmails('gone')).resolves.toBeNull();
    const unconfigured = new LeverClient({ apiKey: '', fetchImpl: f.fn });
    await expect(unconfigured.getOpportunityEmails('opp-1')).resolves.toBeNull();
  });
});
