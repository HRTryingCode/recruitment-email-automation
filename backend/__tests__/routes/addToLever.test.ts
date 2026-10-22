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

const { scheduleGemEnrichment } = vi.hoisted(() => ({ scheduleGemEnrichment: vi.fn() }));
vi.mock('../../src/services/gemEnrichment.service', async () => {
  const actual = await vi.importActual<typeof import('../../src/services/gemEnrichment.service')>(
    '../../src/services/gemEnrichment.service'
  );
  return { ...actual, scheduleGemEnrichment };
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
const gemLookup = vi.fn<(userId: string, email: string, opts?: { extId?: string | null }) => Promise<GemLookup>>();
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
    id: 'g-1',
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
    for (const f of [...Object.values(writer), reader.findByEmail, gemLookup, fetchFn, refreshCandidateLever, scheduleGemEnrichment]) {
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

  describe('GET /api/candidates/:id/lever/prefill (app data only)', () => {
    it('maps candidate + cached Lever state into the proposed payload without calling Gem', async () => {
      reader.findByEmail.mockResolvedValueOnce(status('ACTIVE', [existingOpp('post-des')]));
      mockPrisma.candidate.findUnique.mockResolvedValueOnce({ ...candidateRow, title: 'Staff Engineer', company: 'Acme' });
      const res = await request(app).get(`/api/candidates/${CAND}/lever/prefill`).set(auth);
      expect(res.status).toBe(200);
      const d = res.body.data;
      expect(d).toMatchObject({
        name: 'Jane Doe',
        email: 'jane@example.com',
        headline: 'Staff Engineer at Acme',
        linkedinUrl: null,
        suggestedPostingId: 'post-fe',
        stageId: 'stage-ic',
        stageName: 'Interest Call',
        origin: 'sourced',
        sources: ['Gem outreach'],
        tags: ['paul.b'],
        createEnabled: true,
        candidateId: CAND,
      });
      expect(d).not.toHaveProperty('gem');
      expect(d).not.toHaveProperty('resume');
      expect(d.existing).toHaveLength(1);
      expect(d.existing[0]).toMatchObject({ postingId: 'post-des', postingTitle: 'Product Designer' });
      expect(d.note).toContain('Sounds great!');
      expect(d.note).not.toContain('> hi');
      expect(d.note).toContain('https://app.test/?tab=candidates&q=jane%40example.com');
      expect(gemLookup).not.toHaveBeenCalled();
      expect(res.headers['server-timing']).toMatch(/db;dur=\d+.*lever;dur=\d+.*postings;dur=\d+.*total;dur=\d+/);
    });

    it('uses the cached lever* columns when checked < 1h ago (no live Lever call)', async () => {
      mockPrisma.candidate.findUnique.mockResolvedValueOnce({
        ...candidateRow,
        leverState: 'ACTIVE',
        leverOpportunityId: 'opp-old',
        leverPostingTitle: 'Product Designer',
        leverStage: 'Interest Call',
        leverArchivedReason: null,
        leverCheckedAt: new Date(Date.now() - 10 * 60 * 1000),
      });
      const res = await request(app).get(`/api/candidates/${CAND}/lever/prefill`).set(auth);
      expect(reader.findByEmail).not.toHaveBeenCalled();
      expect(res.body.data.existingState).toBe('ACTIVE');
      expect(res.body.data.existing).toEqual([
        expect.objectContaining({
          id: 'opp-old',
          postingId: 'post-des', // matched to the open posting by title
          postingTitle: 'Product Designer',
          stage: 'Interest Call',
          archived: false,
          leverUrl: 'https://hire.lever.co/candidates/opp-old',
        }),
      ]);
    });

    it('cached NOT_FOUND < 1h → no opportunities, no live call; stale or ERROR → live call', async () => {
      mockPrisma.candidate.findUnique.mockResolvedValueOnce({ ...candidateRow, leverState: 'NOT_FOUND', leverCheckedAt: new Date() });
      const fresh = await request(app).get(`/api/candidates/${CAND}/lever/prefill`).set(auth);
      expect(fresh.body.data.existing).toEqual([]);
      expect(reader.findByEmail).not.toHaveBeenCalled();

      mockPrisma.candidate.findUnique.mockResolvedValueOnce({
        ...candidateRow,
        leverState: 'NOT_FOUND',
        leverCheckedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      });
      await request(app).get(`/api/candidates/${CAND}/lever/prefill`).set(auth);
      mockPrisma.candidate.findUnique.mockResolvedValueOnce({ ...candidateRow, leverState: 'ERROR', leverCheckedAt: new Date() });
      await request(app).get(`/api/candidates/${CAND}/lever/prefill`).set(auth);
      expect(reader.findByEmail).toHaveBeenCalledTimes(2);
    });

    it('stored linkedinUrl is returned canonicalized', async () => {
      mockPrisma.candidate.findUnique.mockResolvedValueOnce({ ...candidateRow, linkedinUrl: 'linkedin.com/in/stored' });
      const res = await request(app).get(`/api/candidates/${CAND}/lever/prefill`).set(auth);
      expect(res.body.data.linkedinUrl).toBe('https://www.linkedin.com/in/stored');
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

  describe('GET /api/candidates/:id/lever/prefill/gem', () => {
    const gemRow = (extra: Record<string, unknown> = {}) => ({
      ...candidateRow,
      gemPersonId: 'g-1',
      gemTitle: 'Staff Engineer',
      gemCompany: 'Acme',
      gemLocation: 'Berlin',
      gemResumeAvailable: true,
      gemFetchedAt: new Date(Date.now() - 60 * 60 * 1000),
      ...extra,
    });

    it('cache miss → live Gem lookup, mapped and persisted (no résumé URL in the response)', async () => {
      gemLookup.mockResolvedValueOnce(GEM_FOUND);
      const res = await request(app).get(`/api/candidates/${CAND}/lever/prefill/gem`).set(auth);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({
        status: 'FOUND',
        source: 'live',
        fetchedAt: expect.any(String),
        name: 'Jane Q. Doe',
        headline: 'Staff Engineer at Acme',
        location: 'Berlin',
        phone: '+49 30 1234',
        linkedinUrl: 'https://www.linkedin.com/in/jane',
        resume: { available: true, source: 'LinkedIn PDF', filename: 'Jane_LinkedIn.pdf' },
      });
      expect(JSON.stringify(res.body)).not.toContain('s3.gem.test');
      expect(gemLookup).toHaveBeenCalledWith(USER, 'jane@example.com', { extId: null });
      expect(mockPrisma.candidate.update).toHaveBeenCalledWith({
        where: { id: CAND },
        data: expect.objectContaining({ gemPersonId: 'g-1', gemResumeAvailable: true }),
      });
      expect(scheduleGemEnrichment).not.toHaveBeenCalled();
    });

    it('fresh cache (< 7 days) → served from the Candidate row, no Gem call', async () => {
      mockPrisma.candidate.findUnique.mockResolvedValueOnce(gemRow({ linkedinUrl: 'https://www.linkedin.com/in/jane' }));
      mockPrisma.gemConnection.findUnique.mockResolvedValueOnce({ status: 'OK', tokens: 'enc' });
      const res = await request(app).get(`/api/candidates/${CAND}/lever/prefill/gem`).set(auth);
      expect(gemLookup).not.toHaveBeenCalled();
      expect(scheduleGemEnrichment).not.toHaveBeenCalled();
      expect(res.body.data).toMatchObject({
        status: 'FOUND',
        source: 'cache',
        headline: 'Staff Engineer at Acme',
        location: 'Berlin',
        linkedinUrl: 'https://www.linkedin.com/in/jane',
        resume: { available: true },
      });
    });

    it('stale cache (> 7 days) → cached data now, refreshed in the background as this user', async () => {
      mockPrisma.candidate.findUnique.mockResolvedValueOnce(gemRow({ gemFetchedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000) }));
      mockPrisma.gemConnection.findUnique.mockResolvedValueOnce({ status: 'OK', tokens: 'enc' });
      const res = await request(app).get(`/api/candidates/${CAND}/lever/prefill/gem`).set(auth);
      expect(res.body.data).toMatchObject({ status: 'FOUND', source: 'cache_stale', location: 'Berlin' });
      expect(gemLookup).not.toHaveBeenCalled();
      expect(scheduleGemEnrichment).toHaveBeenCalledWith(CAND, 'stale', { userId: USER });
    });

    it('cache hit for a user without Gem connected → cached fields, Connect status, no résumé', async () => {
      mockPrisma.candidate.findUnique.mockResolvedValueOnce(gemRow());
      mockPrisma.gemConnection.findUnique.mockResolvedValueOnce(null);
      const res = await request(app).get(`/api/candidates/${CAND}/lever/prefill/gem`).set(auth);
      expect(res.body.data).toMatchObject({ status: 'NOT_CONNECTED', source: 'cache', location: 'Berlin', resume: { available: false } });
    });

    it('cached NOT_FOUND (< 24h) is served without a Gem call', async () => {
      mockPrisma.candidate.findUnique.mockResolvedValueOnce(
        gemRow({ gemPersonId: null, gemTitle: null, gemCompany: null, gemLocation: null, gemResumeAvailable: null })
      );
      mockPrisma.gemConnection.findUnique.mockResolvedValueOnce({ status: 'OK', tokens: 'enc' });
      const res = await request(app).get(`/api/candidates/${CAND}/lever/prefill/gem`).set(auth);
      expect(res.body.data).toMatchObject({ status: 'NOT_FOUND', source: 'cache', location: null });
      expect(gemLookup).not.toHaveBeenCalled();
    });

    it('Gem down → degrades with the manual-LinkedIn message and caches nothing', async () => {
      gemLookup.mockResolvedValueOnce({ status: 'UNAVAILABLE', message: 'Gem unavailable — paste LinkedIn manually' });
      const res = await request(app).get(`/api/candidates/${CAND}/lever/prefill/gem`).set(auth);
      expect(res.body.data).toMatchObject({
        status: 'UNAVAILABLE',
        message: 'Gem unavailable — paste LinkedIn manually',
        resume: { available: false },
      });
      expect(mockPrisma.candidate.update).not.toHaveBeenCalled();
    });

    it('logs one GEM_PREFILL row per attempt with outcome, source and step timings (no PII)', async () => {
      const cases: Array<[GemLookup, string]> = [
        [GEM_FOUND, 'found'],
        [{ status: 'NOT_FOUND' }, 'not_found'],
        [{ status: 'NOT_CONNECTED' }, 'not_connected'],
        [{ status: 'NEEDS_REAUTH' }, 'needs_reauth'],
        [{ status: 'UNAVAILABLE', message: 'Gem unavailable — paste LinkedIn manually' }, 'error'],
      ];
      const timings = { authMs: 5, authRefreshMs: 0, mcpConnectMs: 300, searchMs: 400, getPersonMs: 500, totalMs: 1205, cold: true, clientReused: false };
      for (const [lookup, outcome] of cases) {
        mockPrisma.systemLog.create.mockClear();
        gemLookup.mockResolvedValueOnce({ ...lookup, timings });
        expect((await request(app).get(`/api/candidates/${CAND}/lever/prefill/gem`).set(auth)).status).toBe(200);
        const rows = mockPrisma.systemLog.create.mock.calls.filter((c) => c[0].data.event === 'GEM_PREFILL');
        expect(rows).toHaveLength(1);
        const details = JSON.parse(rows[0]![0].data.details);
        expect(details).toMatchObject({ outcome, userId: USER, source: 'live', ...timings });
        expect(typeof details.durationMs).toBe('number');
        expect(rows[0]![0].data.details).not.toMatch(/jane|linkedin\.com|Berlin|1234|s3\.gem|Acme|Staff Engineer/i);
      }
      const found = { linkedin: true, title: true, location: true, resume: true };
      gemLookup.mockResolvedValueOnce(GEM_FOUND);
      mockPrisma.systemLog.create.mockClear();
      await request(app).get(`/api/candidates/${CAND}/lever/prefill/gem`).set(auth);
      const row = mockPrisma.systemLog.create.mock.calls.find((c) => c[0].data.event === 'GEM_PREFILL')!;
      expect(JSON.parse(row[0].data.details).fields).toEqual(found);
    });

    it('404 for an unknown candidate, 400 for a bad id', async () => {
      mockPrisma.candidate.findUnique.mockResolvedValueOnce(null);
      expect((await request(app).get(`/api/candidates/${CAND}/lever/prefill/gem`).set(auth)).status).toBe(404);
      expect((await request(app).get('/api/candidates/BAD/lever/prefill/gem').set(auth)).status).toBe(400);
    });
  });

  describe('GET /api/lookup/lever-prefill (+ /gem)', () => {
    it('works for an email the app has never seen (app data only)', async () => {
      mockPrisma.candidate.findFirst.mockResolvedValueOnce(null);
      mockPrisma.emailMessage.findFirst.mockResolvedValueOnce(null);
      const res = await request(app).get('/api/lookup/lever-prefill').query({ email: 'New@Example.com' }).set(auth);
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ name: null, email: 'new@example.com', candidateId: null, tags: [] });
      expect(gemLookup).not.toHaveBeenCalled();
    });

    it('/gem looks an unknown email up live (name from Gem) and persists nothing', async () => {
      mockPrisma.candidate.findFirst.mockResolvedValueOnce(null);
      gemLookup.mockResolvedValueOnce(GEM_FOUND);
      const res = await request(app).get('/api/lookup/lever-prefill/gem').query({ email: 'New@Example.com' }).set(auth);
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ status: 'FOUND', source: 'live', name: 'Jane Q. Doe' });
      expect(gemLookup).toHaveBeenCalledWith(USER, 'new@example.com', { extId: null });
      expect(mockPrisma.candidate.update).not.toHaveBeenCalled();
    });

    it('400 on a bad email', async () => {
      expect((await request(app).get('/api/lookup/lever-prefill').query({ email: 'nope' }).set(auth)).status).toBe(400);
      expect((await request(app).get('/api/lookup/lever-prefill/gem').query({ email: 'nope' }).set(auth)).status).toBe(400);
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

    it('a typed scheme-less LinkedIn URL is accepted and sent to Lever canonicalized', async () => {
      const res = await request(app)
        .post(`/api/candidates/${CAND}/lever`)
        .set(auth)
        .send(validBody({ linkedinUrl: 'uk.linkedin.com/in/jane?trk=x' }));
      expect(res.status).toBe(201);
      expect(writer.createOpportunity.mock.calls[0]![0]).toMatchObject({ links: ['https://www.linkedin.com/in/jane'] });
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

      it('reuses the cached Gem person id for the résumé lookup (skips Gem search)', async () => {
        mockPrisma.candidate.findUnique.mockResolvedValueOnce({ ...candidateRow, gemPersonId: 'g-1' });
        gemLookup.mockResolvedValueOnce(GEM_FOUND);
        fetchFn.mockResolvedValueOnce(new Response(pdf, { status: 200, headers: { 'content-type': 'application/pdf' } }));
        const res = await request(app).post(`/api/candidates/${CAND}/lever`).set(auth).send(validBody({ includeResume: true }));
        expect(res.status).toBe(201);
        expect(gemLookup).toHaveBeenCalledWith(USER, 'jane@example.com', { extId: 'g-1' });
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
