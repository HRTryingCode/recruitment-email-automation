import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';

import { buildPrismaMock, resetPrismaMock, type MockPrisma } from '../_setup/mockPrisma';
import { loadApp } from '../_setup/testApp';

const { syncStaleLever } = vi.hoisted(() => ({ syncStaleLever: vi.fn() }));

vi.mock('../../src/services/leverSync.service', async () => {
  const actual = await vi.importActual<typeof import('../../src/services/leverSync.service')>(
    '../../src/services/leverSync.service'
  );
  return { ...actual, syncStaleLever };
});

vi.mock('../../src/db/client', () => {
  const prisma = buildPrismaMock();
  return { prisma, default: prisma };
});

import { prisma as injectedPrisma } from '../../src/db/client';
const mockPrisma = injectedPrisma as unknown as MockPrisma;

const CRON_SECRET = 'test-cron-secret-value';

function result(over: Record<string, unknown> = {}) {
  return {
    skipped: false,
    candidates: 0,
    checked: 0,
    errors: 0,
    byState: {},
    deadlineReached: false,
    aborted: false,
    elapsedMs: 1,
    ...over,
  };
}

function leverRunLogs() {
  return mockPrisma.systemLog.create.mock.calls.filter(
    ([a]) => (a as { data: { event: string } }).data.event === 'LEVER_SYNC_RUN'
  );
}

describe('Lever sync crons', () => {
  const saved = process.env.CRON_SECRET;
  let app: Awaited<ReturnType<typeof loadApp>>;

  beforeEach(async () => {
    process.env.CRON_SECRET = CRON_SECRET;
    resetPrismaMock(mockPrisma);
    syncStaleLever.mockReset();
    app = await loadApp();
  });

  afterEach(() => {
    if (saved === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = saved;
  });

  describe('GET /api/internal/cron/lever-sync (every 3h)', () => {
    it('runs the full stale sync (not never-checked-only)', async () => {
      syncStaleLever.mockResolvedValueOnce(result());
      const res = await request(app).get('/api/internal/cron/lever-sync').set('Authorization', `Bearer ${CRON_SECRET}`);
      expect(res.status).toBe(200);
      expect(syncStaleLever.mock.calls[0]![0].neverCheckedOnly).toBeFalsy();
    });
  });

  describe('GET /api/internal/cron/lever-sync-new (every 15 min)', () => {
    it('returns 401 without the cron secret', async () => {
      const res = await request(app).get('/api/internal/cron/lever-sync-new');
      expect(res.status).toBe(401);
      expect(syncStaleLever).not.toHaveBeenCalled();
    });

    it('processes only never-checked candidates with a short deadline', async () => {
      syncStaleLever.mockResolvedValueOnce(result({ candidates: 2, checked: 2, byState: { NOT_FOUND: 2 } }));
      const before = Date.now();
      const res = await request(app)
        .get('/api/internal/cron/lever-sync-new')
        .set('Authorization', `Bearer ${CRON_SECRET}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ checked: 2 });
      const opts = syncStaleLever.mock.calls[0]![0];
      expect(opts.neverCheckedOnly).toBe(true);
      expect(opts.deadline - before).toBeLessThanOrEqual(60_000);
      expect(leverRunLogs()).toHaveLength(1);
    });

    it('does not write a LEVER_SYNC_RUN row when there was nothing to do', async () => {
      syncStaleLever.mockResolvedValueOnce(result());
      await request(app).get('/api/internal/cron/lever-sync-new').set('Authorization', `Bearer ${CRON_SECRET}`);
      expect(leverRunLogs()).toHaveLength(0);
    });

    it('does not log every 15 min while Lever is unconfigured', async () => {
      syncStaleLever.mockResolvedValueOnce(result({ skipped: true, reason: 'unconfigured' }));
      await request(app).get('/api/internal/cron/lever-sync-new').set('Authorization', `Bearer ${CRON_SECRET}`);
      expect(leverRunLogs()).toHaveLength(0);
    });

    it('logs an aborted run as WARN', async () => {
      syncStaleLever.mockResolvedValueOnce(result({ candidates: 5, checked: 5, errors: 5, aborted: true }));
      await request(app).get('/api/internal/cron/lever-sync-new').set('Authorization', `Bearer ${CRON_SECRET}`);
      const logs = leverRunLogs();
      expect(logs).toHaveLength(1);
      expect((logs[0]![0] as { data: { level: string } }).data.level).toBe('WARN');
    });
  });
});
