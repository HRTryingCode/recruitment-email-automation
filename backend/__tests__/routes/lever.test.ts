import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { buildPrismaMock, resetPrismaMock, type MockPrisma } from '../_setup/mockPrisma';
import { loadApp, bearer } from '../_setup/testApp';

const { syncStaleLever, refreshCandidateLever } = vi.hoisted(() => ({
  syncStaleLever: vi.fn(),
  refreshCandidateLever: vi.fn(),
}));

vi.mock('../../src/services/leverSync.service', async () => {
  const actual = await vi.importActual<typeof import('../../src/services/leverSync.service')>(
    '../../src/services/leverSync.service'
  );
  return { ...actual, syncStaleLever, refreshCandidateLever };
});

vi.mock('../../src/db/client', () => {
  const prisma = buildPrismaMock();
  return { prisma, default: prisma };
});

import { prisma as injected } from '../../src/db/client';
const mockPrisma = injected as unknown as MockPrisma;

const CRON_SECRET = 'test-cron-secret-value';
const CANDIDATE_ID = 'ckabcdefghijklmnopqrstuvw';

const okResult = {
  skipped: false,
  candidates: 2,
  checked: 2,
  errors: 0,
  byState: { ACTIVE: 1, NOT_FOUND: 1 },
  deadlineReached: false,
  aborted: false,
  elapsedMs: 12,
};

describe('Lever routes', () => {
  const original = process.env.CRON_SECRET;
  let app: Awaited<ReturnType<typeof loadApp>>;

  beforeEach(async () => {
    process.env.CRON_SECRET = CRON_SECRET;
    resetPrismaMock(mockPrisma);
    syncStaleLever.mockReset();
    refreshCandidateLever.mockReset();
    app = await loadApp();
  });

  afterEach(() => {
    if (original === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = original;
  });

  describe('GET /api/internal/cron/lever-sync', () => {
    it('401s without the cron secret', async () => {
      const res = await request(app).get('/api/internal/cron/lever-sync');
      expect(res.status).toBe(401);
      expect(syncStaleLever).not.toHaveBeenCalled();
    });

    it('401s with a user JWT instead of the cron secret', async () => {
      const res = await request(app).get('/api/internal/cron/lever-sync').set('Authorization', bearer('u1'));
      expect(res.status).toBe(401);
    });

    it('runs the sync with a deadline inside maxDuration and logs a counts-only summary', async () => {
      syncStaleLever.mockResolvedValueOnce(okResult);
      const before = Date.now();
      const res = await request(app)
        .get('/api/internal/cron/lever-sync')
        .set('Authorization', `Bearer ${CRON_SECRET}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual(okResult);
      const { deadline } = syncStaleLever.mock.calls[0]![0];
      expect(deadline - before).toBeGreaterThan(200_000);
      expect(deadline - before).toBeLessThanOrEqual(250_000);

      const logs = mockPrisma.systemLog.create.mock.calls.filter((c) => c[0].data.event === 'LEVER_SYNC_RUN');
      expect(logs).toHaveLength(1);
      const details = JSON.parse(logs[0]![0].data.details);
      expect(details).toEqual(okResult);
      expect(logs[0]![0].data.details).not.toMatch(/@/);
    });

    it('logs WARN when the run aborted or skipped', async () => {
      syncStaleLever.mockResolvedValueOnce({ ...okResult, skipped: true, reason: 'unconfigured', checked: 0 });
      await request(app).get('/api/internal/cron/lever-sync').set('Authorization', `Bearer ${CRON_SECRET}`);
      const log = mockPrisma.systemLog.create.mock.calls.find((c) => c[0].data.event === 'LEVER_SYNC_RUN')!;
      expect(log[0].data.level).toBe('WARN');
    });
  });

  describe('POST /api/candidates/:id/lever/refresh', () => {
    it('requires auth', async () => {
      const res = await request(app).post(`/api/candidates/${CANDIDATE_ID}/lever/refresh`);
      expect(res.status).toBe(401);
    });

    it('400s on a malformed id', async () => {
      const res = await request(app).post('/api/candidates/NOT-A-CUID/lever/refresh').set('Authorization', bearer('u1'));
      expect(res.status).toBe(400);
      expect(refreshCandidateLever).not.toHaveBeenCalled();
    });

    it('404s for an unknown candidate', async () => {
      refreshCandidateLever.mockResolvedValueOnce(null);
      const res = await request(app)
        .post(`/api/candidates/${CANDIDATE_ID}/lever/refresh`)
        .set('Authorization', bearer('u1'));
      expect(res.status).toBe(404);
    });

    it('returns the updated candidate and the live status', async () => {
      const status = { state: 'ACTIVE', primary: null, opportunities: [], checkedAt: '2026-10-22T00:00:00.000Z' };
      refreshCandidateLever.mockResolvedValueOnce({ candidate: { id: CANDIDATE_ID, leverState: 'ACTIVE' }, status });
      const res = await request(app)
        .post(`/api/candidates/${CANDIDATE_ID}/lever/refresh`)
        .set('Authorization', bearer('u1'));
      expect(res.status).toBe(200);
      expect(refreshCandidateLever).toHaveBeenCalledWith(CANDIDATE_ID);
      expect(res.body.data).toEqual({ candidate: { id: CANDIDATE_ID, leverState: 'ACTIVE' }, lever: status });
    });
  });
});
