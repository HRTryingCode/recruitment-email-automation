import { describe, it, expect, vi } from 'vitest';
import { LeverWriteClient, LeverWriteError } from '../../src/services/leverWrite.service';

// Fake fetch only — no request in this file ever reaches api.lever.co.
type Call = { url: URL; init: RequestInit };

function fakeFetch(responses: Array<{ status?: number; body?: unknown }>) {
  const calls: Call[] = [];
  const impl = vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url: new URL(url), init });
    const r = responses.shift() ?? { status: 500, body: {} };
    return new Response(JSON.stringify(r.body ?? {}), {
      status: r.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

const noLimit = { take: async () => {} };
const client = (f: ReturnType<typeof fakeFetch>) =>
  new LeverWriteClient({ apiKey: 'k', fetchImpl: f.impl, rateLimiter: noLimit, sleep: async () => {} });

const baseInput = {
  name: 'Jane Doe',
  headline: 'Staff Engineer at Acme',
  location: 'Berlin',
  email: 'jane@example.com',
  phone: '+49 30 1234',
  links: ['https://www.linkedin.com/in/jane'],
  tags: ['paul.b'],
  sources: ['Gem outreach'],
  stageId: 'stage-interest',
  postingId: 'post-1',
};

describe('LeverWriteClient.createOpportunity', () => {
  it('JSON: one posting, perform_as + owner = clicker, origin sourced, Bearer auth', async () => {
    const f = fakeFetch([{ status: 201, body: { data: { id: 'opp-new' } } }]);
    const out = await client(f).createOpportunity(baseInput, 'lever-user-1');
    expect(out).toEqual({ id: 'opp-new' });
    const { url, init } = f.calls[0]!;
    expect(init.method).toBe('POST');
    expect(url.pathname).toBe('/v1/opportunities');
    expect(url.searchParams.get('perform_as')).toBe('lever-user-1');
    expect(url.searchParams.has('parse')).toBe(false);
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer k');
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      name: 'Jane Doe',
      headline: 'Staff Engineer at Acme',
      location: 'Berlin',
      emails: ['jane@example.com'],
      phones: [{ value: '+49 30 1234' }],
      links: ['https://www.linkedin.com/in/jane'],
      tags: ['paul.b'],
      sources: ['Gem outreach'],
      origin: 'sourced',
      owner: 'lever-user-1',
      stage: 'stage-interest',
      postings: ['post-1'],
    });
  });

  it('JSON: omits empty optional fields', async () => {
    const f = fakeFetch([{ status: 201, body: { data: { id: 'o' } } }]);
    await client(f).createOpportunity(
      { ...baseInput, headline: null, location: '', phone: null, links: [], stageId: null },
      'u'
    );
    const body = JSON.parse(f.calls[0]!.init.body as string);
    expect(body).not.toHaveProperty('headline');
    expect(body).not.toHaveProperty('location');
    expect(body).not.toHaveProperty('phones');
    expect(body).not.toHaveProperty('stage');
    expect(body.postings).toEqual(['post-1']);
  });

  it('multipart with résumé: parse=true, array fields as name[], resumeFile attached', async () => {
    const f = fakeFetch([{ status: 201, body: { data: { id: 'opp-mp' } } }]);
    const resume = { filename: 'jane.pdf', contentType: 'application/pdf', data: new Uint8Array([37, 80, 68, 70]) };
    const out = await client(f).createOpportunity({ ...baseInput, resume }, 'lever-user-1');
    expect(out.id).toBe('opp-mp');
    const { url, init } = f.calls[0]!;
    expect(url.searchParams.get('parse')).toBe('true');
    expect(url.searchParams.get('perform_as')).toBe('lever-user-1');
    const form = init.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    // fetch sets the multipart boundary itself.
    expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined();
    expect(form.get('name')).toBe('Jane Doe');
    expect(form.getAll('emails[]')).toEqual(['jane@example.com']);
    expect(form.getAll('postings[]')).toEqual(['post-1']);
    expect(form.getAll('links[]')).toEqual(['https://www.linkedin.com/in/jane']);
    expect(form.getAll('tags[]')).toEqual(['paul.b']);
    expect(form.getAll('sources[]')).toEqual(['Gem outreach']);
    expect(form.get('origin')).toBe('sourced');
    expect(form.get('owner')).toBe('lever-user-1');
    expect(form.get('stage')).toBe('stage-interest');
    const file = form.get('resumeFile') as File;
    expect(file.name).toBe('jane.pdf');
    expect(file.size).toBe(4);
  });

  it('maps a Lever 4xx to a readable LeverWriteError with Lever\'s message', async () => {
    const f = fakeFetch([{ status: 400, body: { code: 'BadRequestError', message: 'Invalid stage id' } }]);
    const err = await client(f).createOpportunity(baseInput, 'u').catch((e) => e);
    expect(err).toBeInstanceOf(LeverWriteError);
    expect(err.status).toBe(400);
    expect(err.message).toBe('Lever rejected the request: Invalid stage id');
  });

  it('401/403 says the key lacks permission', async () => {
    const f = fakeFetch([{ status: 403, body: {} }]);
    const err = await client(f).createOpportunity(baseInput, 'u').catch((e) => e);
    expect(err.status).toBe(403);
    expect(err.message).toMatch(/permission/i);
  });

  it('does not retry a write on 5xx (never double-create)', async () => {
    const f = fakeFetch([{ status: 502 }, { status: 201, body: { data: { id: 'x' } } }]);
    const err = await client(f).createOpportunity(baseInput, 'u').catch((e) => e);
    expect(err).toBeInstanceOf(LeverWriteError);
    expect(err.status).toBe(502);
    expect(f.calls).toHaveLength(1);
  });

  it('retries a write on 429 (Lever did not process it)', async () => {
    const f = fakeFetch([{ status: 429 }, { status: 201, body: { data: { id: 'x' } } }]);
    expect(await client(f).createOpportunity(baseInput, 'u')).toEqual({ id: 'x' });
    expect(f.calls).toHaveLength(2);
  });

  it('refuses without a key', async () => {
    const c = new LeverWriteClient({ apiKey: '', fetchImpl: vi.fn() as unknown as typeof fetch });
    await expect(c.createOpportunity(baseInput, 'u')).rejects.toThrow(/not configured/i);
  });
});

describe('LeverWriteClient.addNote', () => {
  it('POSTs {value} to /opportunities/:id/notes as perform_as', async () => {
    const f = fakeFetch([{ status: 201, body: { data: { noteId: 'n1' } } }]);
    await client(f).addNote('opp 1', 'hello', 'lever-user-1');
    const { url, init } = f.calls[0]!;
    expect(url.pathname).toBe('/v1/opportunities/opp%201/notes');
    expect(url.searchParams.get('perform_as')).toBe('lever-user-1');
    expect(JSON.parse(init.body as string)).toEqual({ value: 'hello' });
  });
});

describe('LeverWriteClient reads', () => {
  it('listOpenPostings: published + internal, both channels, paginated, normalized', async () => {
    const f = fakeFetch([
      {
        body: {
          data: [{ id: 'p1', text: 'Founding Engineer', state: 'published', categories: { team: 'Eng', location: 'NYC' } }],
          hasNext: true,
          next: 'tok',
        },
      },
      { body: { data: [{ id: 'p2', text: 'Designer', state: 'published', categories: {} }], hasNext: false } },
      { body: { data: [{ id: 'p3', text: 'Internal Ops', state: 'internal' }], hasNext: false } },
    ]);
    const out = await client(f).listOpenPostings();
    expect(out).toEqual([
      { id: 'p1', title: 'Founding Engineer', team: 'Eng', location: 'NYC', state: 'published' },
      { id: 'p2', title: 'Designer', team: null, location: null, state: 'published' },
      { id: 'p3', title: 'Internal Ops', team: null, location: null, state: 'internal' },
    ]);
    const first = f.calls[0]!.url;
    expect(first.searchParams.get('state')).toBe('published');
    expect(first.searchParams.getAll('distributionChannel')).toEqual(['public', 'internal']);
    expect(f.calls[1]!.url.searchParams.get('offset')).toBe('tok');
    expect(f.calls[2]!.url.searchParams.get('state')).toBe('internal');
    for (const c of f.calls) expect(c.init.method).toBe('GET');
  });

  it('findUserByEmail: first active user, or null', async () => {
    const f = fakeFetch([
      { body: { data: [{ id: 'u1', name: 'Paul', email: 'paul.b@archive.com', deactivatedAt: null }] } },
      { body: { data: [] } },
      { body: { data: [{ id: 'u2', name: 'Gone', email: 'g@archive.com', deactivatedAt: 123 }] } },
    ]);
    const c = client(f);
    expect(await c.findUserByEmail('Paul.B@archive.com')).toEqual({ id: 'u1', name: 'Paul', email: 'paul.b@archive.com' });
    expect(f.calls[0]!.url.searchParams.get('email')).toBe('paul.b@archive.com');
    expect(await c.findUserByEmail('nobody@archive.com')).toBeNull();
    expect(await c.findUserByEmail('g@archive.com')).toBeNull();
  });

  it('listStages: id + text', async () => {
    const f = fakeFetch([{ body: { data: [{ id: 's1', text: 'New lead' }, { id: 's2', text: 'Interest Call' }] } }]);
    expect(await client(f).listStages()).toEqual([
      { id: 's1', text: 'New lead' },
      { id: 's2', text: 'Interest Call' },
    ]);
  });
});
