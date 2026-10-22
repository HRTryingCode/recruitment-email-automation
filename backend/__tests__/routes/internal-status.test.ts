import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';

import { buildPrismaMock, resetPrismaMock, type MockPrisma } from '../_setup/mockPrisma';
import { loadApp, bearer } from '../_setup/testApp';

vi.mock('../../src/db/client', () => {
  const prisma = buildPrismaMock();
  return { prisma, default: prisma };
});

import { prisma as injectedPrisma } from '../../src/db/client';
const mockPrisma = injectedPrisma as unknown as MockPrisma;

const AUTH = bearer('test-user-1');

describe('GET /api/internal/sync-health', () => {
  let app: Awaited<ReturnType<typeof loadApp>>;

  beforeEach(async () => {
    resetPrismaMock(mockPrisma);
    app = await loadApp();
  });

  it('returns 401 without an Authorization header', async () => {
    const res = await request(app).get('/api/internal/sync-health');
    expect(res.status).toBe(401);
    expect(mockPrisma.mailbox.findMany).not.toHaveBeenCalled();
  });

  const NOW = new Date('2026-10-22T12:00:00Z');
  const minsAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

  const mb1 = {
    id: 'mb-1',
    provider: 'GMAIL',
    emailAddress: 'inbox@archive.com',
    displayName: 'Inbox',
    isActive: true,
    authStatus: 'OK',
    lastAuthError: null,
    lastAuthErrorAt: null,
    watchExpiry: new Date(NOW.getTime() + 36 * 3600_000),
    createdAt: new Date('2026-04-01T00:00:00Z'),
  };
  const mb2 = {
    id: 'mb-2',
    provider: 'GMAIL',
    emailAddress: 'sofia@archive.com',
    displayName: null,
    isActive: true,
    authStatus: 'NEEDS_REAUTH',
    lastAuthError: 'invalid_grant',
    lastAuthErrorAt: minsAgo(90),
    watchExpiry: new Date('2026-05-29T00:00:00Z'),
    createdAt: new Date('2026-04-02T00:00:00Z'),
  };

  function statsRow(mailboxId: string, o: Record<string, unknown> = {}) {
    // $queryRaw returns COUNT(*) as bigint.
    return {
      mailboxId,
      lastSyncedMessageAt: null,
      messagesLast24h: 0n,
      totalMessages: 0n,
      totalCandidates: 0n,
      pendingDrafts: 0n,
      candidatesNeedsReview: 0n,
      ...o,
    };
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns per-mailbox health from at most 3 grouped queries', async () => {
    mockPrisma.mailbox.findMany.mockResolvedValueOnce([mb1, mb2]);
    mockPrisma.$queryRaw.mockResolvedValueOnce([
      statsRow('mb-1', {
        lastSyncedMessageAt: minsAgo(120),
        messagesLast24h: 7n,
        totalMessages: 42n,
        totalCandidates: 5n,
        pendingDrafts: 2n,
        candidatesNeedsReview: 1n,
      }),
      statsRow('mb-2'),
    ]);
    mockPrisma.systemLog.findMany.mockResolvedValueOnce([
      { event: 'WEBHOOK_HANDLER_ERROR', createdAt: minsAgo(5), details: JSON.stringify({ emailAddress: 'inbox@archive.com', error: 'boom' }) },
      { event: 'RECONCILIATION_RUN', createdAt: minsAgo(30), details: JSON.stringify({ mailboxId: 'mb-1', missingBefore: 3, ingested: 3 }) },
      { event: 'RECONCILIATION_RUN', createdAt: minsAgo(30), details: JSON.stringify({ summary: true }) },
      { event: 'WEBHOOK_HANDLER_ERROR', createdAt: minsAgo(40), details: JSON.stringify({ emailAddress: 'inbox@archive.com', error: 'boom2' }) },
      // sofia@: failing every hour since her last success.
      { event: 'RECONCILIATION_FAILED', createdAt: minsAgo(30), details: JSON.stringify({ mailboxId: 'mb-2', error: 'invalid_grant' }) },
      { event: 'RECONCILIATION_FAILED', createdAt: minsAgo(90), details: JSON.stringify({ mailboxId: 'mb-2', error: 'invalid_grant' }) },
      { event: 'RECONCILIATION_RUN', createdAt: minsAgo(150), details: JSON.stringify({ mailboxId: 'mb-2', missingBefore: 0 }) },
      { event: 'RECONCILIATION_FAILED', createdAt: minsAgo(210), details: JSON.stringify({ mailboxId: 'mb-2', error: 'older' }) },
      // Older than 24h: excluded from the 24h webhook error count.
      { event: 'WEBHOOK_HANDLER_ERROR', createdAt: minsAgo(25 * 60), details: JSON.stringify({ emailAddress: 'inbox@archive.com', error: 'old' }) },
    ]);

    const res = await request(app).get('/api/internal/sync-health').set('Authorization', AUTH);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);

    // M2: no per-mailbox fan-out.
    expect(mockPrisma.mailbox.findMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(mockPrisma.systemLog.findMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.emailMessage.count).not.toHaveBeenCalled();
    expect(mockPrisma.emailMessage.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.candidate.count).not.toHaveBeenCalled();
    expect(mockPrisma.emailDraft.count).not.toHaveBeenCalled();

    const h1 = res.body.data.find((m: { mailboxId: string }) => m.mailboxId === 'mb-1');
    expect(h1).toMatchObject({
      emailAddress: 'inbox@archive.com',
      displayName: 'Inbox',
      isActive: true,
      authStatus: 'OK',
      lastAuthError: null,
      watchExpiresInHours: 36,
      lastSyncedMessageAt: minsAgo(120).toISOString(),
      lastReconciliationAt: minsAgo(30).toISOString(),
      lastReconciliationFoundMissing: 3,
      lastReconcileError: null,
      consecutiveReconcileFailures: 0,
      messagesLast24h: 7,
      totalMessages: 42,
      totalCandidates: 5,
      pendingDrafts: 2,
      candidatesNeedsReview: 1,
      webhookErrorsLast24h: 2,
      lastWebhookError: 'boom',
      error: false,
    });

    const h2 = res.body.data.find((m: { mailboxId: string }) => m.mailboxId === 'mb-2');
    expect(h2).toMatchObject({
      authStatus: 'NEEDS_REAUTH',
      lastAuthError: 'invalid_grant',
      lastAuthErrorAt: minsAgo(90).toISOString(),
      lastReconciliationAt: minsAgo(150).toISOString(),
      lastReconcileError: 'invalid_grant',
      consecutiveReconcileFailures: 2,
      error: false,
    });
    expect(h2.watchExpiresInHours).toBeLessThan(0);
  });

  it('flags rows with error=true instead of returning healthy-looking zeros when the stats query fails', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockPrisma.mailbox.findMany.mockResolvedValueOnce([mb1]);
    mockPrisma.$queryRaw.mockRejectedValueOnce(new Error('pool timeout'));
    mockPrisma.systemLog.findMany.mockResolvedValueOnce([]);

    const res = await request(app).get('/api/internal/sync-health').set('Authorization', AUTH);

    expect(res.status).toBe(200);
    expect(res.body.data[0]).toMatchObject({
      mailboxId: 'mb-1',
      authStatus: 'OK',
      error: true,
      messagesLast24h: null,
      totalMessages: null,
      pendingDrafts: null,
    });
    errSpy.mockRestore();
  });
});
