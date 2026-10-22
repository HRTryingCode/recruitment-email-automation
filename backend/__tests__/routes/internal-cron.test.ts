import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';

import { buildPrismaMock, resetPrismaMock, type MockPrisma } from '../_setup/mockPrisma';
import { loadApp } from '../_setup/testApp';

// Both cron endpoints reach into gmail.service. Hoisted mocks let each test
// program the renewGmailWatches count and the per-mailbox reconcile result.
const { renewGmailWatches, reconcileMailbox, sweepStuckMessages, pruneSystemLog, sweepScheduledSends } = vi.hoisted(() => ({
  sweepScheduledSends: vi.fn(),
  renewGmailWatches: vi.fn(),
  reconcileMailbox: vi.fn(),
  sweepStuckMessages: vi.fn(),
  pruneSystemLog: vi.fn(),
}));

vi.mock('../../src/services/systemLogRetention.service', () => ({ pruneSystemLog }));
vi.mock('../../src/services/draftSend.service', () => ({ sweepScheduledSends }));

vi.mock('../../src/services/gmail.service', async () => {
  const actual = await vi.importActual<typeof import('../../src/services/gmail.service')>(
    '../../src/services/gmail.service'
  );
  return {
    ...actual,
    renewGmailWatches,
    reconcileMailbox,
    sweepStuckMessages,
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
    sweepStuckMessages.mockReset();
    sweepScheduledSends.mockReset().mockResolvedValue({ sent: 0, failed: 0, skipped: 0, interrupted: 0 });
    pruneSystemLog.mockReset();
    app = await loadApp();
  });

  afterEach(() => {
    if (originalCronSecret === undefined) {
      delete process.env.CRON_SECRET;
    } else {
      process.env.CRON_SECRET = originalCronSecret;
    }
  });

  describe('GET /api/internal/cron/renew-watches', () => {
    it('returns 401 without a CRON_SECRET bearer header', async () => {
      const res = await request(app).get('/api/internal/cron/renew-watches');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(renewGmailWatches).not.toHaveBeenCalled();
    });

    it('returns 401 when the bearer secret does not match', async () => {
      const res = await request(app)
        .get('/api/internal/cron/renew-watches')
        .set('Authorization', 'Bearer wrong-secret');
      expect(res.status).toBe(401);
      expect(renewGmailWatches).not.toHaveBeenCalled();
    });

    it('runs renewGmailWatches and returns the renewed count when authorized', async () => {
      renewGmailWatches.mockResolvedValueOnce(4);

      const res = await request(app)
        .get('/api/internal/cron/renew-watches')
        .set('Authorization', `Bearer ${CRON_SECRET}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual({ renewed: 4 });
      expect(renewGmailWatches).toHaveBeenCalledTimes(1);
    });
  });

  describe('GET /api/internal/cron/reconcile', () => {
    it('returns 401 without a CRON_SECRET bearer header', async () => {
      const res = await request(app).get('/api/internal/cron/reconcile');
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
        .get('/api/internal/cron/reconcile')
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

    it('rejects the secret in x-vercel-cron-signature (L10: Bearer header only)', async () => {
      const res = await request(app)
        .get('/api/internal/cron/reconcile')
        .set('x-vercel-cron-signature', CRON_SECRET);

      expect(res.status).toBe(401);
      expect(mockPrisma.mailbox.findMany).not.toHaveBeenCalled();
    });

    it('rejects a bearer that is a prefix of the secret', async () => {
      const res = await request(app)
        .get('/api/internal/cron/reconcile')
        .set('Authorization', `Bearer ${CRON_SECRET.slice(0, -1)}`);

      expect(res.status).toBe(401);
      expect(mockPrisma.mailbox.findMany).not.toHaveBeenCalled();
    });

    it('rejects everything when CRON_SECRET is unset', async () => {
      delete process.env.CRON_SECRET;
      const res = await request(app)
        .get('/api/internal/cron/reconcile')
        .set('Authorization', 'Bearer ');

      expect(res.status).toBe(401);
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
        .get('/api/internal/cron/reconcile')
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

  describe('GET /api/internal/cron/reconcile — fairness (M1)', () => {
    const mk = (id: string) => ({
      id,
      provider: 'GMAIL',
      emailAddress: `${id}@archive.com`,
      isActive: true,
      authStatus: 'OK',
      lastReconciledAt: null,
      createdAt: new Date('2026-04-01T00:00:00Z'),
    });
    const ok = { scannedFromGmail: 1, missingBefore: 0, ingested: 0 };

    it('processes the least-recently-reconciled mailboxes first', async () => {
      mockPrisma.mailbox.findMany.mockResolvedValueOnce([]);
      await request(app).get('/api/internal/cron/reconcile').set('Authorization', `Bearer ${CRON_SECRET}`);
      expect(mockPrisma.mailbox.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ lastReconciledAt: { sort: 'asc', nulls: 'first' } }, { createdAt: 'asc' }],
        })
      );
    });

    it('stamps lastReconciledAt on every attempted mailbox, including failures', async () => {
      mockPrisma.mailbox.findMany.mockResolvedValueOnce([mk('mb-1'), mk('mb-2')]);
      reconcileMailbox.mockRejectedValueOnce(new Error('Gmail 503')).mockResolvedValueOnce(ok);

      await request(app).get('/api/internal/cron/reconcile').set('Authorization', `Bearer ${CRON_SECRET}`);

      const stamped = mockPrisma.mailbox.update.mock.calls
        .filter((c) => c[0].data.lastReconciledAt instanceof Date)
        .map((c) => c[0].where.id)
        .sort();
      expect(stamped).toEqual(['mb-1', 'mb-2']);
    });

    it('reconciles mailboxes concurrently (default 2 at a time)', async () => {
      mockPrisma.mailbox.findMany.mockResolvedValueOnce([mk('mb-1'), mk('mb-2'), mk('mb-3')]);
      let inFlight = 0;
      let maxInFlight = 0;
      reconcileMailbox.mockImplementation(async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight -= 1;
        return ok;
      });

      const res = await request(app)
        .get('/api/internal/cron/reconcile')
        .set('Authorization', `Bearer ${CRON_SECRET}`);

      expect(res.body.data.results.map((r: { mailboxId: string }) => r.mailboxId)).toEqual([
        'mb-1',
        'mb-2',
        'mb-3',
      ]);
      expect(maxInFlight).toBe(2);
    });
  });

  describe('GET /api/internal/cron/sweep-stuck-messages (M3)', () => {
    it('returns 401 without the cron secret', async () => {
      const res = await request(app).get('/api/internal/cron/sweep-stuck-messages');
      expect(res.status).toBe(401);
      expect(sweepStuckMessages).not.toHaveBeenCalled();
    });

    it('runs the sweeper with a deadline and returns its counts', async () => {
      sweepStuckMessages.mockResolvedValueOnce({ found: 3, processed: 2, failed: 1, skipped: 0 });
      const res = await request(app)
        .get('/api/internal/cron/sweep-stuck-messages')
        .set('Authorization', `Bearer ${CRON_SECRET}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ found: 3, processed: 2, failed: 1, skipped: 0 });
      expect(sweepStuckMessages).toHaveBeenCalledWith(
        expect.objectContaining({ deadline: expect.any(Number) })
      );
    });

    it('also sends one-step-send drafts whose waitUntil timer was lost (U0)', async () => {
      sweepStuckMessages.mockResolvedValueOnce({ found: 0, processed: 0, failed: 0, skipped: 0 });
      sweepScheduledSends.mockResolvedValueOnce({ sent: 2, failed: 0, skipped: 0, interrupted: 1 });
      const res = await request(app)
        .get('/api/internal/cron/sweep-stuck-messages')
        .set('Authorization', `Bearer ${CRON_SECRET}`);
      expect(res.status).toBe(200);
      expect(sweepScheduledSends).toHaveBeenCalledTimes(1);
      expect(res.body.data.scheduledSends).toEqual({ sent: 2, failed: 0, skipped: 0, interrupted: 1 });
    });

    it('a scheduled-send sweep failure does not stop the message sweep', async () => {
      sweepScheduledSends.mockRejectedValueOnce(new Error('db blip'));
      sweepStuckMessages.mockResolvedValueOnce({ found: 1, processed: 1, failed: 0, skipped: 0 });
      const res = await request(app)
        .get('/api/internal/cron/sweep-stuck-messages')
        .set('Authorization', `Bearer ${CRON_SECRET}`);
      expect(res.status).toBe(200);
      expect(sweepStuckMessages).toHaveBeenCalled();
      expect(res.body.data.scheduledSends).toBeNull();
    });
  });

  describe('GET /api/internal/cron/systemlog-retention (M26)', () => {
    const original = process.env.SYSTEMLOG_RETENTION_ENABLED;
    afterEach(() => {
      if (original === undefined) delete process.env.SYSTEMLOG_RETENTION_ENABLED;
      else process.env.SYSTEMLOG_RETENTION_ENABLED = original;
    });

    it('returns 401 without the cron secret', async () => {
      const res = await request(app).get('/api/internal/cron/systemlog-retention');
      expect(res.status).toBe(401);
      expect(pruneSystemLog).not.toHaveBeenCalled();
    });

    it('is a dry run unless SYSTEMLOG_RETENTION_ENABLED=true', async () => {
      delete process.env.SYSTEMLOG_RETENTION_ENABLED;
      pruneSystemLog.mockResolvedValueOnce({ enabled: false, deleted: 0 });
      await request(app)
        .get('/api/internal/cron/systemlog-retention')
        .set('Authorization', `Bearer ${CRON_SECRET}`);
      expect(pruneSystemLog).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
    });

    it('deletes when SYSTEMLOG_RETENTION_ENABLED=true', async () => {
      process.env.SYSTEMLOG_RETENTION_ENABLED = 'true';
      pruneSystemLog.mockResolvedValueOnce({ enabled: true, deleted: 10 });
      const res = await request(app)
        .get('/api/internal/cron/systemlog-retention')
        .set('Authorization', `Bearer ${CRON_SECRET}`);
      expect(res.body.data).toMatchObject({ enabled: true, deleted: 10 });
      expect(pruneSystemLog).toHaveBeenCalledWith(expect.objectContaining({ enabled: true }));
    });
  });

  describe('GET /api/internal/cron/reconcile — auth revocation (H1)', () => {
    const mb = {
      id: 'mb-sofia',
      provider: 'GMAIL',
      emailAddress: 'sofia@archive.com',
      displayName: 'Sofia',
      isActive: true,
      authStatus: 'OK',
      createdAt: new Date('2026-01-01T00:00:00Z'),
    };

    function invalidGrant(): Error {
      const err = new Error('invalid_grant') as Error & Record<string, unknown>;
      err.name = 'GaxiosError';
      err.config = { data: 'refresh_token=1//0SECRET-REFRESH&client_secret=GOCSPX-shh' };
      err.response = { status: 400, data: { error: 'invalid_grant' } };
      return err;
    }

    it('skips NEEDS_REAUTH mailboxes', async () => {
      mockPrisma.mailbox.findMany.mockResolvedValueOnce([]);
      await request(app)
        .get('/api/internal/cron/reconcile')
        .set('Authorization', `Bearer ${CRON_SECRET}`);
      expect(mockPrisma.mailbox.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ authStatus: { not: 'NEEDS_REAUTH' } }),
        })
      );
    });

    it('marks the mailbox NEEDS_REAUTH on invalid_grant and never logs the raw GaxiosError', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockPrisma.mailbox.findMany.mockResolvedValueOnce([mb]);
      mockPrisma.mailbox.updateMany.mockResolvedValueOnce({ count: 1 });
      reconcileMailbox.mockRejectedValueOnce(invalidGrant());

      const res = await request(app)
        .get('/api/internal/cron/reconcile')
        .set('Authorization', `Bearer ${CRON_SECRET}`);

      expect(res.status).toBe(200);
      expect(mockPrisma.mailbox.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'mb-sofia', authStatus: { not: 'NEEDS_REAUTH' } },
          data: expect.objectContaining({ authStatus: 'NEEDS_REAUTH' }),
        })
      );
      const events = mockPrisma.systemLog.create.mock.calls.map((c) => c[0].data);
      expect(events.filter((e) => e.event === 'MAILBOX_AUTH_REVOKED')).toHaveLength(1);
      const failed = events.find((e) => e.event === 'RECONCILIATION_FAILED');
      expect(failed.level).toBe('ERROR');
      expect(JSON.parse(failed.details)).toMatchObject({ authRevoked: true, error: 'invalid_grant' });

      const dumped = JSON.stringify(errorSpy.mock.calls);
      expect(dumped).not.toContain('SECRET');
      expect(dumped).not.toContain('GOCSPX');
      errorSpy.mockRestore();
    });

    it('logs transient failures as WARN without touching authStatus', async () => {
      mockPrisma.mailbox.findMany.mockResolvedValueOnce([mb]);
      reconcileMailbox.mockRejectedValueOnce(new Error('Gmail 503'));

      await request(app)
        .get('/api/internal/cron/reconcile')
        .set('Authorization', `Bearer ${CRON_SECRET}`);

      expect(mockPrisma.mailbox.updateMany).not.toHaveBeenCalled();
      const failed = mockPrisma.systemLog.create.mock.calls
        .map((c) => c[0].data)
        .find((e) => e.event === 'RECONCILIATION_FAILED');
      expect(failed.level).toBe('WARN');
    });
  });

  describe('GET /api/internal/cron/watchdog (H3)', () => {
    const HOOK = 'https://hooks.slack.com/services/T/B/X';
    const NOW = new Date('2026-10-22T12:00:00Z');
    const originalHook = process.env.SLACK_ALERT_WEBHOOK_URL;
    let fetchMock: ReturnType<typeof vi.fn>;

    const healthy = {
      id: 'mb-ok',
      emailAddress: 'ok@archive.com',
      authStatus: 'OK',
      lastAuthError: null,
      watchExpiry: new Date(NOW.getTime() + 5 * 24 * 3600_000),
      createdAt: new Date('2026-01-01T00:00:00Z'),
    };
    const revoked = {
      id: 'mb-aaron',
      emailAddress: 'aaronrampersad@archive.com',
      authStatus: 'NEEDS_REAUTH',
      lastAuthError: 'invalid_grant',
      watchExpiry: new Date(NOW.getTime() + 2 * 24 * 3600_000),
      createdAt: new Date('2026-01-01T00:00:00Z'),
    };

    function reconRun(mailboxId: string, minutesAgo: number) {
      return {
        event: 'RECONCILIATION_RUN',
        details: JSON.stringify({ mailboxId, ingested: 0 }),
        createdAt: new Date(NOW.getTime() - minutesAgo * 60_000),
      };
    }
    function summary(minutesAgo: number, deadlineReached = false) {
      return {
        event: 'RECONCILIATION_RUN',
        details: JSON.stringify({ summary: true, deadlineReached }),
        createdAt: new Date(NOW.getTime() - minutesAgo * 60_000),
      };
    }

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(NOW);
      fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      vi.stubGlobal('fetch', fetchMock);
      process.env.SLACK_ALERT_WEBHOOK_URL = HOOK;
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.unstubAllGlobals();
      if (originalHook === undefined) delete process.env.SLACK_ALERT_WEBHOOK_URL;
      else process.env.SLACK_ALERT_WEBHOOK_URL = originalHook;
    });

    function slackTexts(): string[] {
      return fetchMock.mock.calls.map((c) => JSON.parse(c[1].body).text as string);
    }

    function stateRowsWritten() {
      return mockPrisma.systemLog.create.mock.calls
        .map((c) => c[0].data)
        .filter((d) => d.event === 'WATCHDOG_STATE');
    }

    it('returns 401 without the cron secret', async () => {
      const res = await request(app).get('/api/internal/cron/watchdog');
      expect(res.status).toBe(401);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('stays silent when everything is healthy', async () => {
      mockPrisma.mailbox.findMany.mockResolvedValueOnce([healthy]);
      mockPrisma.systemLog.findMany.mockResolvedValueOnce([summary(20), reconRun('mb-ok', 20)]);
      mockPrisma.systemLog.findFirst.mockResolvedValueOnce(null);

      const res = await request(app)
        .get('/api/internal/cron/watchdog')
        .set('Authorization', `Bearer ${CRON_SECRET}`);

      expect(res.status).toBe(200);
      expect(res.body.data.issues).toEqual([]);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(stateRowsWritten()).toHaveLength(0);
    });

    it('alerts once when a mailbox flips to NEEDS_REAUTH, then stays quiet while it persists', async () => {
      // Run 1: new issue -> alert + state row.
      mockPrisma.mailbox.findMany.mockResolvedValueOnce([healthy, revoked]);
      mockPrisma.systemLog.findMany.mockResolvedValueOnce([summary(20), reconRun('mb-ok', 20)]);
      mockPrisma.systemLog.findFirst.mockResolvedValueOnce(null);

      const r1 = await request(app)
        .get('/api/internal/cron/watchdog')
        .set('Authorization', `Bearer ${CRON_SECRET}`);

      expect(r1.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(slackTexts()[0]).toContain('aaronrampersad@archive.com');
      expect(slackTexts()[0]).toMatch(/reconnect/i);
      const state = stateRowsWritten();
      expect(state).toHaveLength(1);
      const stored = JSON.parse(state[0].details);
      expect(stored.active.map((a: { key: string }) => a.key)).toEqual(['needs_reauth:mb-aaron']);

      // Run 2: same state persisted -> no alert, no new state row.
      mockPrisma.systemLog.create.mockClear();
      mockPrisma.mailbox.findMany.mockResolvedValueOnce([healthy, revoked]);
      mockPrisma.systemLog.findMany.mockResolvedValueOnce([summary(5), reconRun('mb-ok', 5)]);
      mockPrisma.systemLog.findFirst.mockResolvedValueOnce({ details: state[0].details });

      await request(app)
        .get('/api/internal/cron/watchdog')
        .set('Authorization', `Bearer ${CRON_SECRET}`);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(stateRowsWritten()).toHaveLength(0);
    });

    it('sends a resolved message when an issue clears', async () => {
      mockPrisma.mailbox.findMany.mockResolvedValueOnce([healthy]);
      mockPrisma.systemLog.findMany.mockResolvedValueOnce([summary(5), reconRun('mb-ok', 5)]);
      mockPrisma.systemLog.findFirst.mockResolvedValueOnce({
        details: JSON.stringify({
          active: [{ key: 'needs_reauth:mb-aaron', title: 'aaronrampersad@archive.com needs reconnect' }],
        }),
      });

      await request(app)
        .get('/api/internal/cron/watchdog')
        .set('Authorization', `Bearer ${CRON_SECRET}`);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(slackTexts()[0]).toMatch(/resolved/i);
      expect(slackTexts()[0]).toContain('aaronrampersad@archive.com');
      expect(JSON.parse(stateRowsWritten()[0].details).active).toEqual([]);
    });

    it("fires the dead-man's switch when no reconcile has run in 2h", async () => {
      mockPrisma.mailbox.findMany.mockResolvedValueOnce([healthy]);
      mockPrisma.systemLog.findMany.mockResolvedValueOnce([summary(150), reconRun('mb-ok', 150)]);
      mockPrisma.systemLog.findFirst.mockResolvedValueOnce(null);

      const res = await request(app)
        .get('/api/internal/cron/watchdog')
        .set('Authorization', `Bearer ${CRON_SECRET}`);

      const keys = res.body.data.issues.map((i: { key: string }) => i.key);
      expect(keys).toContain('reconcile_dead');
      // Per-mailbox staleness is implied by the dead cron; don't spam it.
      expect(keys).not.toContain('reconcile_stale:mb-ok');
      expect(slackTexts()[0]).toMatch(/reconcile/i);
    });

    it('detects expired watches, stale per-mailbox reconcile, deadline streaks and webhook error bursts', async () => {
      const expired = { ...healthy, id: 'mb-exp', emailAddress: 'exp@archive.com', watchExpiry: new Date(NOW.getTime() - 3600_000) };
      const stale = { ...healthy, id: 'mb-stale', emailAddress: 'stale@archive.com' };
      const webhookErrors = Array.from({ length: 25 }, (_, i) => ({
        event: 'WEBHOOK_HANDLER_ERROR',
        details: '{}',
        createdAt: new Date(NOW.getTime() - i * 60_000),
      }));
      mockPrisma.mailbox.findMany.mockResolvedValueOnce([healthy, expired, stale]);
      mockPrisma.systemLog.findMany.mockResolvedValueOnce([
        summary(10, true),
        summary(70, true),
        summary(130, true),
        reconRun('mb-ok', 10),
        reconRun('mb-exp', 10),
        reconRun('mb-stale', 200),
        ...webhookErrors,
      ]);
      mockPrisma.systemLog.findFirst.mockResolvedValueOnce(null);

      const res = await request(app)
        .get('/api/internal/cron/watchdog')
        .set('Authorization', `Bearer ${CRON_SECRET}`);

      const keys = res.body.data.issues.map((i: { key: string }) => i.key).sort();
      expect(keys).toEqual(
        ['reconcile_deadline', 'reconcile_stale:mb-stale', 'watch_expired:mb-exp', 'webhook_errors'].sort()
      );
      // All new issues go out in one Slack message.
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('does not record issues as notified when Slack is unconfigured (no-op), so they alert once configured', async () => {
      delete process.env.SLACK_ALERT_WEBHOOK_URL;
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      mockPrisma.mailbox.findMany.mockResolvedValueOnce([revoked]);
      mockPrisma.systemLog.findMany.mockResolvedValueOnce([summary(5)]);
      mockPrisma.systemLog.findFirst.mockResolvedValueOnce(null);

      const res = await request(app)
        .get('/api/internal/cron/watchdog')
        .set('Authorization', `Bearer ${CRON_SECRET}`);

      expect(res.status).toBe(200);
      expect(res.body.data.alerting).toBe('disabled');
      expect(fetchMock).not.toHaveBeenCalled();
      expect(stateRowsWritten()).toHaveLength(0);
      warnSpy.mockRestore();
    });

    it('retries next run if the Slack post fails', async () => {
      fetchMock.mockResolvedValueOnce({ ok: false, status: 500 });
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      mockPrisma.mailbox.findMany.mockResolvedValueOnce([revoked]);
      mockPrisma.systemLog.findMany.mockResolvedValueOnce([summary(5)]);
      mockPrisma.systemLog.findFirst.mockResolvedValueOnce(null);

      await request(app)
        .get('/api/internal/cron/watchdog')
        .set('Authorization', `Bearer ${CRON_SECRET}`);

      expect(stateRowsWritten()).toHaveLength(0);
      warnSpy.mockRestore();
    });
  });

  // Vercel Cron only issues GET. A POST must never trigger a job, even with
  // a valid CRON_SECRET — otherwise the "401" tests above could pass for the
  // wrong reason (falling through to the JWT-guarded internal-status router).
  describe('POST is not a cron entry point', () => {
    it.each(['/api/internal/cron/renew-watches', '/api/internal/cron/reconcile'])(
      'POST %s with a valid bearer secret does not run the job',
      async (path) => {
        mockPrisma.mailbox.findMany.mockResolvedValue([]);

        const res = await request(app)
          .post(path)
          .set('Authorization', `Bearer ${CRON_SECRET}`);

        expect(res.status).not.toBe(200);
        expect(res.body?.success).not.toBe(true);
        expect(renewGmailWatches).not.toHaveBeenCalled();
        expect(reconcileMailbox).not.toHaveBeenCalled();
        expect(mockPrisma.mailbox.findMany).not.toHaveBeenCalled();
      }
    );
  });
});

// ── Audit B6 / H8: orphan-body retention cron ───────────────────────────────
describe('GET /api/internal/cron/purge-orphan-bodies', () => {
  const savedSecret = process.env.CRON_SECRET;
  const savedDays = process.env.ORPHAN_BODY_RETENTION_DAYS;
  let app: Awaited<ReturnType<typeof loadApp>>;

  beforeEach(async () => {
    process.env.CRON_SECRET = CRON_SECRET;
    delete process.env.ORPHAN_BODY_RETENTION_DAYS;
    resetPrismaMock(mockPrisma);
    app = await loadApp();
  });

  afterEach(() => {
    if (savedSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = savedSecret;
    if (savedDays === undefined) delete process.env.ORPHAN_BODY_RETENTION_DAYS;
    else process.env.ORPHAN_BODY_RETENTION_DAYS = savedDays;
  });

  it('requires the cron secret', async () => {
    const res = await request(app).get('/api/internal/cron/purge-orphan-bodies');
    expect(res.status).toBe(401);
  });

  it('is a no-op while ORPHAN_BODY_RETENTION_DAYS is unset (needs human approval to enable)', async () => {
    const res = await request(app)
      .get('/api/internal/cron/purge-orphan-bodies')
      .set('Authorization', `Bearer ${CRON_SECRET}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ skipped: true });
    expect(mockPrisma.emailMessage.count).not.toHaveBeenCalled();
    expect(mockPrisma.emailMessage.updateMany).not.toHaveBeenCalled();
  });

  it('is a no-op for a window under 7 days', async () => {
    process.env.ORPHAN_BODY_RETENTION_DAYS = '2';
    const res = await request(app)
      .get('/api/internal/cron/purge-orphan-bodies')
      .set('Authorization', `Bearer ${CRON_SECRET}`);
    expect(res.body.data).toMatchObject({ skipped: true });
    expect(mockPrisma.emailMessage.updateMany).not.toHaveBeenCalled();
  });

  it('purges and logs when enabled', async () => {
    process.env.ORPHAN_BODY_RETENTION_DAYS = '30';
    mockPrisma.emailMessage.count.mockResolvedValueOnce(1);
    mockPrisma.emailMessage.findMany
      .mockResolvedValueOnce([{ id: 'a' }])
      .mockResolvedValueOnce([]);
    mockPrisma.emailMessage.updateMany.mockResolvedValueOnce({ count: 1 });
    const res = await request(app)
      .get('/api/internal/cron/purge-orphan-bodies')
      .set('Authorization', `Bearer ${CRON_SECRET}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ purged: 1, complete: true });
    const logged = mockPrisma.systemLog.create.mock.calls.find(
      ([a]) => (a as { data: { event: string } }).data.event === 'ORPHAN_BODIES_PURGED'
    );
    expect(logged).toBeDefined();
  });
});
