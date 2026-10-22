import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { buildPrismaMock, resetPrismaMock, type MockPrisma } from '../_setup/mockPrisma';
import { loadApp, bearer } from '../_setup/testApp';

const { refreshCandidateLever } = vi.hoisted(() => ({ refreshCandidateLever: vi.fn() }));
vi.mock('../../src/services/leverSync.service', async () => {
  const actual = await vi.importActual<typeof import('../../src/services/leverSync.service')>(
    '../../src/services/leverSync.service'
  );
  return { ...actual, refreshCandidateLever };
});

vi.mock('../../src/db/client', () => {
  const prisma = buildPrismaMock();
  return { prisma, default: prisma };
});

import { prisma as injected } from '../../src/db/client';
import { addToLeverDeps, __resetAddToLeverState } from '../../src/services/addToLever.service';
import { LeverWriteError } from '../../src/services/leverWrite.service';
import type { LeverStatus } from '../../src/services/lever.service';
import type { GemLookup } from '../../src/services/gem.service';

const mockPrisma = injected as unknown as MockPrisma;

const USER = 'ckuser000000000000000001';
const CAND = 'ckcand000000000000000001';
const POSTINGS = [
  { id: 'post-fe', title: 'Founding Engineer', team: 'Eng', location: 'NYC', state: 'published' },
  { id: 'post-des', title: 'Product Designer', team: 'Design', location: 'Remote', state: 'published' },
];
const STAGES = [
  { id: 'stage-new', text: 'New lead' },
  { id: 'stage-ic', text: 'Interest Call' },
];

// Fake Lever (write client + status reader) and Gem — no network anywhere.
const writer = {
  configured: true,
  listOpenPostings: vi.fn(),
  listStages: vi.fn(),
  findUserByEmail: vi.fn(),
  createOpportunity: vi.fn(),
  addNote: vi.fn(),
};
const reader = { configured: true, findByEmail: vi.fn() };
const gemLookup = vi.fn<(userId: string, email: string) => Promise<GemLookup>>();
const fetchFn = vi.fn();

function status(state: LeverStatus['state'], opportunities: LeverStatus['opportunities'] = []): LeverStatus {
  return { state, primary: opportunities[0] ?? null, opportunities, checkedAt: '2026-10-22T12:00:00.000Z' };
}

const existingOpp = (postingId: string, extra = {}) => ({
  id: 'opp-old',
  postingId,
  postingTitle: postingId === 'post-fe' ? 'Founding Engineer' : 'Product Designer',
  stage: 'Interest Call',
  archived: false,
  hired: false,
  archivedReason: null,
  createdAt: null,
  updatedAt: null,
  leverUrl: 'https://hire.lever.co/candidates/opp-old',
  ...extra,
});

const candidateRow = {
  id: CAND,
  name: 'Jane Doe',
  email: 'jane@example.com',
  role: 'Founding Engineer',
  title: null,
  company: null,
  linkedinUrl: null,
  mailbox: { emailAddress: 'paul.b@archive.com' },
};

const GEM_FOUND: GemLookup = {
  status: 'FOUND',
  person: {
    name: 'Jane Q. Doe',
    title: 'Staff Engineer',
    company: 'Acme',
    location: 'Berlin',
    phone: '+49 30 1234',
    linkedinUrl: 'https://www.linkedin.com/in/jane',
    resume: { url: 'https://s3.gem.test/r.pdf?sig=1', filename: 'Jane_LinkedIn.pdf', source: 'LinkedIn PDF' },
  },
};

const validBody = (extra: Record<string, unknown> = {}) => ({
  name: 'Jane Doe',
  headline: 'Staff Engineer at Acme',
  location: 'Berlin',
  phone: '+49 30 1234',
  linkedinUrl: 'https://www.linkedin.com/in/jane',
  postingId: 'post-fe',
  tags: ['paul.b'],
  sources: ['Gem outreach'],
  note: 'Added from the app',
  includeResume: false,
  idempotencyKey: 'idem-key-0000000000001',
  ...extra,
});

describe('Add to Lever routes', () => {
  let app: Awaited<ReturnType<typeof loadApp>>;
  const original = { ...addToLeverDeps };

  beforeEach(async () => {
    resetPrismaMock(mockPrisma);
    __resetAddToLeverState();
    for (const f of [...Object.values(writer), reader.findByEmail, gemLookup, fetchFn, refreshCandidateLever]) {
      if (typeof f === 'function') (f as ReturnType<typeof vi.fn>).mockReset();
    }
    addToLeverDeps.writer = () => writer as never;
    addToLeverDeps.reader = () => reader as never;
    addToLeverDeps.gemLookup = gemLookup;
    addToLeverDeps.fetchFn = fetchFn as unknown as typeof fetch;

    writer.listOpenPostings.mockResolvedValue(POSTINGS);
    writer.listStages.mockResolvedValue(STAGES);
    writer.findUserByEmail.mockResolvedValue({ id: 'lever-paul', name: 'Paul', email: 'paul.b@archive.com' });
    writer.createOpportunity.mockResolvedValue({ id: 'opp-new' });
    writer.addNote.mockResolvedValue(undefined);
    reader.findByEmail.mockResolvedValue(status('NOT_FOUND'));
    gemLookup.mockResolvedValue({ status: 'NOT_CONNECTED' });
    refreshCandidateLever.mockResolvedValue({ candidate: { id: CAND, leverState: 'ACTIVE' }, status: status('ACTIVE') });
    mockPrisma.user.findUnique.mockResolvedValue({ id: USER, role: 'recruiter', email: 'paul.b@archive.com' });
    mockPrisma.candidate.findUnique.mockResolvedValue(candidateRow);
    mockPrisma.candidate.update.mockResolvedValue(candidateRow);
    mockPrisma.emailMessage.findFirst.mockResolvedValue({
      bodyText: 'Sounds great!\n\nOn Mon Paul wrote:\n> hi',
      receivedAt: new Date('2026-10-20T09:00:00Z'),
      mailbox: { emailAddress: 'paul.b@archive.com' },
      thread: { externalThreadId: 'gthread1' },
    });
    mockPrisma.systemLog.findFirst.mockResolvedValue(null);
    process.env.LEVER_CREATE_ENABLED = 'true';
    process.env.FRONTEND_URL = 'https://app.test';
    app = await loadApp();
  });

  afterEach(() => {
    Object.assign(addToLeverDeps, original);
    delete process.env.LEVER_CREATE_ENABLED;
  });

  const auth = { Authorization: bearer(USER) };

  describe('GET /api/lever/postings + /api/lever/me', () => {
    it('lists open postings with stages and the default Interest Call stage', async () => {
      const res = await request(app).get('/api/lever/postings').set(auth);
      expect(res.status).toBe(200);
      expect(res.body.data.postings).toEqual(POSTINGS);
      expect(res.body.data.stages).toEqual(STAGES);
      expect(res.body.data.defaultStageId).toBe('stage-ic');
    });

    it('caches postings for 10 minutes', async () => {
      await request(app).get('/api/lever/postings').set(auth);
      await request(app).get('/api/lever/postings').set(auth);
      expect(writer.listOpenPostings).toHaveBeenCalledTimes(1);
    });

    it('/me reports the flag and the caller’s Lever user', async () => {
      const res = await request(app).get('/api/lever/me').set(auth);
      expect(res.body.data).toEqual({
        configured: true,
        createEnabled: true,
        appEmail: 'paul.b@archive.com',
        leverUser: { id: 'lever-paul', name: 'Paul' },
      });
      process.env.LEVER_CREATE_ENABLED = 'false';
      writer.findUserByEmail.mockResolvedValueOnce(null);
      __resetAddToLeverState();
      const off = await request(app).get('/api/lever/me').set(auth);
      expect(off.body.data.createEnabled).toBe(false);
      expect(off.body.data.leverUser).toBeNull();
    });
  });

  describe('GET /api/candidates/:id/lever/prefill', () => {
    it('maps candidate + Gem + Lever into the proposed payload', async () => {
      gemLookup.mockResolvedValueOnce(GEM_FOUND);
      reader.findByEmail.mockResolvedValueOnce(status('ACTIVE', [existingOpp('post-des')]));
      const res = await request(app).get(`/api/candidates/${CAND}/lever/prefill`).set(auth);
      expect(res.status).toBe(200);
      const d = res.body.data;
      expect(d).toMatchObject({
        name: 'Jane Doe',
        email: 'jane@example.com',
        headline: 'Staff Engineer at Acme',
        location: 'Berlin',
        phone: '+49 30 1234',
        linkedinUrl: 'https://www.linkedin.com/in/jane',
        resume: { available: true, source: 'LinkedIn PDF', filename: 'Jane_LinkedIn.pdf' },
        suggestedPostingId: 'post-fe',
        stageId: 'stage-ic',
        stageName: 'Interest Call',
        origin: 'sourced',
        sources: ['Gem outreach'],
        tags: ['paul.b'],
        gem: { status: 'FOUND' },
        createEnabled: true,
        candidateId: CAND,
      });
      expect(d.existing).toHaveLength(1);
      expect(d.existing[0]).toMatchObject({ postingId: 'post-des', postingTitle: 'Product Designer' });
      expect(d.note).toContain('Sounds great!');
      expect(d.note).not.toContain('> hi');
      expect(d.note).toContain('https://app.test/?tab=candidates&q=jane%40example.com');
      // The presigned résumé URL stays server-side.
      expect(JSON.stringify(d)).not.toContain('s3.gem.test');
      expect(gemLookup).toHaveBeenCalledWith(USER, 'jane@example.com');
    });

    it('Gem down → degrades with the manual-LinkedIn message; stored linkedinUrl wins', async () => {
      gemLookup.mockResolvedValueOnce({ status: 'UNAVAILABLE', message: 'Gem unavailable — paste LinkedIn manually' });
      mockPrisma.candidate.findUnique.mockResolvedValueOnce({ ...candidateRow, linkedinUrl: 'https://linkedin.com/in/stored' });
      const res = await request(app).get(`/api/candidates/${CAND}/lever/prefill`).set(auth);
      expect(res.body.data.gem).toEqual({ status: 'UNAVAILABLE', message: 'Gem unavailable — paste LinkedIn manually' });
      expect(res.body.data.linkedinUrl).toBe('https://linkedin.com/in/stored');
      expect(res.body.data.resume.available).toBe(false);
    });

    it('no matching posting → suggestedPostingId null', async () => {
      mockPrisma.candidate.findUnique.mockResolvedValueOnce({ ...candidateRow, role: 'Head of Sales' });
      const res = await request(app).get(`/api/candidates/${CAND}/lever/prefill`).set(auth);
      expect(res.body.data.suggestedPostingId).toBeNull();
    });

    it('404 for an unknown candidate, 400 for a bad id', async () => {
      mockPrisma.candidate.findUnique.mockResolvedValueOnce(null);
      expect((await request(app).get(`/api/candidates/${CAND}/lever/prefill`).set(auth)).status).toBe(404);
      expect((await request(app).get('/api/candidates/BAD/lever/prefill').set(auth)).status).toBe(400);
    });
  });

  describe('GET /api/lookup/lever-prefill', () => {
    it('works for an email the app has never seen (name from Gem)', async () => {
      mockPrisma.candidate.findFirst.mockResolvedValueOnce(null);
      mockPrisma.emailMessage.findFirst.mockResolvedValueOnce(null);
      gemLookup.mockResolvedValueOnce(GEM_FOUND);
      const res = await request(app).get('/api/lookup/lever-prefill').query({ email: 'New@Example.com' }).set(auth);
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ name: 'Jane Q. Doe', email: 'new@example.com', candidateId: null, tags: [] });
    });

    it('400 on a bad email', async () => {
      expect((await request(app).get('/api/lookup/lever-prefill').query({ email: 'nope' }).set(auth)).status).toBe(400);
    });
  });

  describe('POST /api/candidates/:id/lever', () => {
    it('flag off → 403 "Add to Lever is turned off", nothing sent to Lever', async () => {
      process.env.LEVER_CREATE_ENABLED = 'false';
      const res = await request(app).post(`/api/candidates/${CAND}/lever`).set(auth).send(validBody());
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Add to Lever is turned off');
      expect(writer.createOpportunity).not.toHaveBeenCalled();
    });

    it('caller has no Lever user → 409 naming their email', async () => {
      writer.findUserByEmail.mockResolvedValueOnce(null);
      const res = await request(app).post(`/api/candidates/${CAND}/lever`).set(auth).send(validBody());
      expect(res.status).toBe(409);
      expect(res.body.error).toBe("Your Lever account wasn't found for paul.b@archive.com");
      expect(writer.createOpportunity).not.toHaveBeenCalled();
    });

    it('already on THAT posting → 409 with a link, no create', async () => {
      reader.findByEmail.mockResolvedValueOnce(status('ACTIVE', [existingOpp('post-fe')]));
      const res = await request(app).post(`/api/candidates/${CAND}/lever`).set(auth).send(validBody());
      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/already in Lever for Founding Engineer/);
      expect(res.body.existing).toEqual({ id: 'opp-old', leverUrl: 'https://hire.lever.co/candidates/opp-old', postingTitle: 'Founding Engineer' });
      expect(writer.createOpportunity).not.toHaveBeenCalled();
    });

    it('in Lever on ANOTHER posting → allowed ("Add to another job")', async () => {
      reader.findByEmail.mockResolvedValueOnce(status('ACTIVE', [existingOpp('post-des')]));
      const res = await request(app).post(`/api/candidates/${CAND}/lever`).set(auth).send(validBody());
      expect(res.status).toBe(201);
    });

    it('Lever status check failing → refuse (never create blind)', async () => {
      reader.findByEmail.mockResolvedValueOnce({ ...status('ERROR'), reason: 'timeout' });
      const res = await request(app).post(`/api/candidates/${CAND}/lever`).set(auth).send(validBody());
      expect(res.status).toBe(502);
      expect(writer.createOpportunity).not.toHaveBeenCalled();
    });

    it('closed/unknown posting → 400', async () => {
      const res = await request(app).post(`/api/candidates/${CAND}/lever`).set(auth).send(validBody({ postingId: 'post-gone' }));
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('That job is no longer open in Lever');
    });

    it('validates the body (postingId + idempotencyKey required, LinkedIn must be https)', async () => {
      for (const bad of [
        validBody({ postingId: undefined }),
        validBody({ idempotencyKey: undefined }),
        validBody({ name: ' ' }),
        validBody({ linkedinUrl: 'javascript:alert(1)' }),
        validBody({ stageId: 'stage-nope' }),
      ]) {
        const res = await request(app).post(`/api/candidates/${CAND}/lever`).set(auth).send(bad);
        expect(res.status).toBe(400);
      }
      expect(writer.createOpportunity).not.toHaveBeenCalled();
    });

    it('creates as the clicker (perform_as + owner), adds the note, refreshes the badge, logs ids only', async () => {
      const res = await request(app).post(`/api/candidates/${CAND}/lever`).set(auth).send(validBody());
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({
        opportunityId: 'opp-new',
        leverUrl: 'https://hire.lever.co/candidates/opp-new',
        postingTitle: 'Founding Engineer',
        stageName: 'Interest Call',
        resumeAttached: false,
        noteAdded: true,
      });
      const [input, performAs] = writer.createOpportunity.mock.calls[0]!;
      expect(performAs).toBe('lever-paul');
      expect(input).toMatchObject({
        name: 'Jane Doe',
        email: 'jane@example.com',
        postingId: 'post-fe',
        stageId: 'stage-ic',
        links: ['https://www.linkedin.com/in/jane'],
        tags: ['paul.b'],
        sources: ['Gem outreach'],
        resume: null,
      });
      expect(writer.addNote).toHaveBeenCalledWith('opp-new', 'Added from the app', 'lever-paul');
      expect(refreshCandidateLever).toHaveBeenCalledWith(CAND, expect.anything());
      expect(mockPrisma.candidate.update).toHaveBeenCalledWith({
        where: { id: CAND },
        data: { linkedinUrl: 'https://www.linkedin.com/in/jane' },
      });

      const log = mockPrisma.systemLog.create.mock.calls.find((c) => c[0].data.event === 'LEVER_OPPORTUNITY_CREATED')!;
      const details = JSON.parse(log[0].data.details);
      expect(Object.keys(details).sort()).toEqual(['actorUserId', 'candidateId', 'idempotencyKey', 'opportunityId', 'postingId']);
      expect(details).toMatchObject({ actorUserId: USER, candidateId: CAND, opportunityId: 'opp-new', postingId: 'post-fe' });
      expect(log[0].data.details).not.toMatch(/jane|Jane|Berlin|linkedin/);
    });

    it('a failed note is reported, not fatal', async () => {
      writer.addNote.mockRejectedValueOnce(new LeverWriteError(400, 'Lever rejected the request: bad note'));
      const res = await request(app).post(`/api/candidates/${CAND}/lever`).set(auth).send(validBody());
      expect(res.status).toBe(201);
      expect(res.body.data.noteAdded).toBe(false);
    });

    it('idempotency: a double-click with the same key creates once and returns the first result', async () => {
      let release!: () => void;
      writer.createOpportunity.mockImplementationOnce(
        () => new Promise((r) => (release = () => r({ id: 'opp-once' })))
      );
      const a = request(app).post(`/api/candidates/${CAND}/lever`).set(auth).send(validBody()).then((r) => r);
      const b = request(app).post(`/api/candidates/${CAND}/lever`).set(auth).send(validBody()).then((r) => r);
      await vi.waitFor(() => expect(writer.createOpportunity).toHaveBeenCalledTimes(1));
      release();
      const [ra, rb] = await Promise.all([a, b]);
      expect(ra.body.data.opportunityId).toBe('opp-once');
      expect(rb.body.data.opportunityId).toBe('opp-once');
      expect(writer.createOpportunity).toHaveBeenCalledTimes(1);

      const again = await request(app).post(`/api/candidates/${CAND}/lever`).set(auth).send(validBody());
      expect(again.body.data.opportunityId).toBe('opp-once');
      expect(writer.createOpportunity).toHaveBeenCalledTimes(1);
    });

    it('idempotency across instances: a recent SystemLog with the key short-circuits', async () => {
      mockPrisma.systemLog.findFirst.mockResolvedValueOnce({
        details: JSON.stringify({ opportunityId: 'opp-elsewhere', postingId: 'post-fe', idempotencyKey: 'idem-key-0000000000001' }),
      });
      const res = await request(app).post(`/api/candidates/${CAND}/lever`).set(auth).send(validBody());
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ opportunityId: 'opp-elsewhere', duplicateRequest: true });
      expect(writer.createOpportunity).not.toHaveBeenCalled();
    });

    it('a failed create can be retried with the same key', async () => {
      writer.createOpportunity.mockRejectedValueOnce(new LeverWriteError(400, 'Lever rejected the request: Invalid email'));
      const first = await request(app).post(`/api/candidates/${CAND}/lever`).set(auth).send(validBody());
      expect(first.status).toBe(422);
      expect(first.body.error).toBe('Lever rejected the request: Invalid email');
      const second = await request(app).post(`/api/candidates/${CAND}/lever`).set(auth).send(validBody());
      expect(second.status).toBe(201);
    });

    it('Lever auth failure surfaces as 502 (never 401, which would log the recruiter out)', async () => {
      writer.createOpportunity.mockRejectedValueOnce(new LeverWriteError(401, 'Lever refused: the API key lacks permission'));
      const res = await request(app).post(`/api/candidates/${CAND}/lever`).set(auth).send(validBody());
      expect(res.status).toBe(502);
      expect(res.body.error).toMatch(/permission/);
    });

    describe('résumé from Gem', () => {
      const pdf = new Uint8Array([37, 80, 68, 70, 45]);

      it('streams the newest Gem résumé to Lever (multipart) and does not persist it', async () => {
        gemLookup.mockResolvedValueOnce(GEM_FOUND);
        fetchFn.mockResolvedValueOnce(new Response(pdf, { status: 200, headers: { 'content-type': 'application/pdf' } }));
        const res = await request(app).post(`/api/candidates/${CAND}/lever`).set(auth).send(validBody({ includeResume: true }));
        expect(res.status).toBe(201);
        expect(res.body.data.resumeAttached).toBe(true);
        expect(fetchFn.mock.calls[0]![0]).toBe('https://s3.gem.test/r.pdf?sig=1');
        const [input] = writer.createOpportunity.mock.calls[0]!;
        expect(input.resume).toMatchObject({ filename: 'Jane_LinkedIn.pdf', contentType: 'application/pdf' });
        expect(Array.from(input.resume.data)).toEqual(Array.from(pdf));
      });

      it('a résumé download failure falls back to JSON without it', async () => {
        gemLookup.mockResolvedValueOnce(GEM_FOUND);
        fetchFn.mockResolvedValueOnce(new Response('denied', { status: 403 }));
        const res = await request(app).post(`/api/candidates/${CAND}/lever`).set(auth).send(validBody({ includeResume: true }));
        expect(res.status).toBe(201);
        expect(res.body.data.resumeAttached).toBe(false);
        expect(writer.createOpportunity.mock.calls[0]![0].resume).toBeNull();
      });

      it('a non-document content type or oversize body is not attached', async () => {
        gemLookup.mockResolvedValue(GEM_FOUND);
        fetchFn.mockResolvedValueOnce(new Response('<html/>', { status: 200, headers: { 'content-type': 'text/html' } }));
        let res = await request(app).post(`/api/candidates/${CAND}/lever`).set(auth).send(validBody({ includeResume: true }));
        expect(res.body.data.resumeAttached).toBe(false);
        fetchFn.mockResolvedValueOnce(
          new Response(pdf, { status: 200, headers: { 'content-type': 'application/pdf', 'content-length': String(50 * 1024 * 1024) } })
        );
        res = await request(app)
          .post(`/api/candidates/${CAND}/lever`)
          .set(auth)
          .send(validBody({ includeResume: true, idempotencyKey: 'idem-key-0000000000002' }));
        expect(res.body.data.resumeAttached).toBe(false);
      });
    });
  });

  describe('POST /api/lookup/lever', () => {
    it('creates for an unknown email (name required), refreshes nothing local', async () => {
      mockPrisma.candidate.findFirst.mockResolvedValue(null);
      const bad = await request(app).post('/api/lookup/lever').set(auth).send(validBody({ email: 'new@example.com', name: '' }));
      expect(bad.status).toBe(400);
      const res = await request(app).post('/api/lookup/lever').set(auth).send(validBody({ email: 'New@Example.com' }));
      expect(res.status).toBe(201);
      expect(writer.createOpportunity.mock.calls[0]![0].email).toBe('new@example.com');
      expect(refreshCandidateLever).not.toHaveBeenCalled();
    });

    it('an email that is a known candidate refreshes that candidate', async () => {
      mockPrisma.candidate.findFirst.mockResolvedValue({ id: CAND });
      const res = await request(app).post('/api/lookup/lever').set(auth).send(validBody({ email: 'jane@example.com' }));
      expect(res.status).toBe(201);
      expect(refreshCandidateLever).toHaveBeenCalledWith(CAND, expect.anything());
    });

    it('flag off → 403', async () => {
      process.env.LEVER_CREATE_ENABLED = 'nope';
      const res = await request(app).post('/api/lookup/lever').set(auth).send(validBody({ email: 'a@b.com' }));
      expect(res.status).toBe(403);
    });
  });
});
