import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';

import { buildPrismaMock, resetPrismaMock, type MockPrisma } from '../_setup/mockPrisma';
import { loadApp } from '../_setup/testApp';

// Both cron endpoints reach into gmail.service. Hoisted mocks let each test
// program the renewGmailWatches count and the per-mailbox reconcile result.
const { renewGmailWatches, reconcileMailbox } = vi.hoisted(() => ({
  renewGmailWatches: vi.fn(),
  reconcileMailbox: vi.fn(),
}));

vi.mock('../../src/services/gmail.service', async () => {
  const actual = await vi.importActual<typeof import('../../src/services/gmail.service')>(
    '../../src/services/gmail.service'
  );
  return {
    ...actual,
    renewGmailWatches,
    reconcileMailbox,
  };
});

vi.mock('../../src/db/client', () => {
  const prisma = buildPrismaMock();
  return { prisma, default: prisma };
});

import { prisma as injectedPrisma } from '../../src/db/client';
const mockPrisma = injectedPrisma as unknown as MockPrisma;

const CRON_SECRET = 'test-cron-secret-value';

describe('/api/internal/cron', () => {
  const originalCronSecret = process.env.CRON_SECRET;
  let app: Awaited<ReturnType<typeof loadApp>>;

  beforeEach(async () => {
    process.env.CRON_SECRET = CRON_SECRET;
    resetPrismaMock(mockPrisma);
    renewGmailWatches.mockReset();
    reconcileMailbox.mockReset();
    app = await loadApp();
  });

  afterEach(() => {
    if (originalCronSecret === undefined) {
      delete process.env.CRON_SECRET;
    } else {
      process.env.CRON_SECRET = originalCronSecret;
    }
  });

  describe('POST /api/internal/cron/renew-watches', () => {
    it('returns 401 without a CRON_SECRET bearer header', async () => {
      const res = await request(app).post('/api/internal/cron/renew-watches');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(renewGmailWatches).not.toHaveBeenCalled();
    });

    it('returns 401 when the bearer secret does not match', async () => {
      const res = await request(app)
        .post('/api/internal/cron/renew-watches')
        .set('Authorization', 'Bearer wrong-secret');
      expect(res.status).toBe(401);
      expect(renewGmailWatches).not.toHaveBeenCalled();
    });

    it('runs renewGmailWatches and returns the renewed count when authorized', async () => {
      renewGmailWatches.mockResolvedValueOnce(4);

      const res = await request(app)
        .post('/api/internal/cron/renew-watches')
        .set('Authorization', `Bearer ${CRON_SECRET}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual({ renewed: 4 });
      expect(renewGmailWatches).toHaveBeenCalledTimes(1);
    });
  });

  describe('POST /api/internal/cron/reconcile', () => {
    it('returns 401 without a CRON_SECRET bearer header', async () => {
      const res = await request(app).post('/api/internal/cron/reconcile');
      expect(res.status).toBe(401);
      expect(reconcileMailbox).not.toHaveBeenCalled();
    });

    it('iterates per mailbox and returns the aggregate result', async () => {
      const mb1 = {
        id: 'mb-1',
        provider: 'GMAIL',
        emailAddress: 'a@archive.com',
        displayName: 'A',
        isActive: true,
        createdAt: new Date('2026-04-01T00:00:00Z'),
      };
      const mb2 = {
        id: 'mb-2',
        provider: 'GMAIL',
        emailAddress: 'b@archive.com',
        displayName: 'B',
        isActive: true,
        createdAt: new Date('2026-04-02T00:00:00Z'),
      };

      mockPrisma.mailbox.findMany.mockResolvedValueOnce([mb1, mb2]);

      reconcileMailbox.mockResolvedValueOnce({
        scannedFromGmail: 20,
        missingBefore: 1,
        ingested: 1,
      });
      reconcileMailbox.mockResolvedValueOnce({
        scannedFromGmail: 15,
        missingBefore: 0,
        ingested: 0,
      });

      const res = await request(app)
        .post('/api/internal/cron/reconcile')
        .set('Authorization', `Bearer ${CRON_SECRET}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toMatchObject({
        mailboxCount: 2,
        totalIngested: 1,
        totalMissing: 1,
        totalScanned: 35,
        deadlineReached: false,
      });
      expect(typeof res.body.data.elapsedMs).toBe('number');
      expect(res.body.data.elapsedMs).toBeGreaterThanOrEqual(0);
      expect(res.body.data.results).toHaveLength(2);
      expect(reconcileMailbox).toHaveBeenCalledTimes(2);
      expect(reconcileMailbox).toHaveBeenNthCalledWith(
        1,
        'mb-1',
        expect.objectContaining({ deadline: expect.any(Number) })
      );
      expect(reconcileMailbox).toHaveBeenNthCalledWith(
        2,
        'mb-2',
        expect.objectContaining({ deadline: expect.any(Number) })
      );
    });

    it('also accepts the x-vercel-cron-signature header', async () => {
      mockPrisma.mailbox.findMany.mockResolvedValueOnce([]);

      const res = await request(app)
        .post('/api/internal/cron/reconcile')
        .set('x-vercel-cron-signature', CRON_SECRET);

      expect(res.status).toBe(200);
      expect(res.body.data.mailboxCount).toBe(0);
    });

    it('captures per-mailbox failures without aborting the loop', async () => {
      const mb1 = {
        id: 'mb-1',
        provider: 'GMAIL',
        emailAddress: 'a@archive.com',
        displayName: 'A',
        isActive: true,
        createdAt: new Date('2026-04-01T00:00:00Z'),
      };
      const mb2 = {
        id: 'mb-2',
        provider: 'GMAIL',
        emailAddress: 'b@archive.com',
        displayName: 'B',
        isActive: true,
        createdAt: new Date('2026-04-02T00:00:00Z'),
      };

      mockPrisma.mailbox.findMany.mockResolvedValueOnce([mb1, mb2]);
      reconcileMailbox.mockRejectedValueOnce(new Error('Gmail 503'));
      reconcileMailbox.mockResolvedValueOnce({
        scannedFromGmail: 10,
        missingBefore: 0,
        ingested: 0,
      });

      const res = await request(app)
        .post('/api/internal/cron/reconcile')
        .set('Authorization', `Bearer ${CRON_SECRET}`);

      expect(res.status).toBe(200);
      expect(res.body.data.results).toHaveLength(2);
      const errored = res.body.data.results.find(
        (r: { mailboxId: string }) => r.mailboxId === 'mb-1'
      );
      expect(errored.error).toMatch(/Gmail 503/);
      // The second mailbox should have been processed despite the first failing.
      expect(reconcileMailbox).toHaveBeenCalledTimes(2);
    });
  });
});
