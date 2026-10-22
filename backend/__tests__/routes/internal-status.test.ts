import { describe, it, expect, beforeEach, vi } from 'vitest';
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

  it('returns the expected sync-health shape per mailbox', async () => {
    const now = new Date('2026-05-21T12:00:00Z');
    const watchExpiry = new Date(now.getTime() + 36 * 60 * 60 * 1000); // ~36h ahead
    const lastMsgAt = new Date(now.getTime() - 2 * 60 * 60 * 1000); // 2h ago

    const mb1 = {
      id: 'mb-1',
      provider: 'GMAIL',
      emailAddress: 'inbox@archive.com',
      displayName: 'Inbox',
      isActive: true,
      watchExpiry,
      createdAt: new Date('2026-04-01T00:00:00Z'),
    };
    const mb2 = {
      id: 'mb-2',
      provider: 'GMAIL',
      emailAddress: 'second@archive.com',
      displayName: null,
      isActive: false,
      watchExpiry: null,
      createdAt: new Date('2026-04-02T00:00:00Z'),
    };

    mockPrisma.mailbox.findMany.mockResolvedValue([mb1, mb2]);

    // Every mock below is keyed on the query's `where` arguments rather than
    // on call order, so adding, removing or reordering queries in the handler
    // can't silently hand one query another query's fixture (finding L18).
    type Where = { where?: Record<string, unknown> };

    mockPrisma.systemLog.findMany.mockImplementation(async ({ where }: Where = {}) => {
      switch (where?.event) {
        // Recent webhook errors, bucketed by emailAddress for the error count.
        case 'WEBHOOK_HANDLER_ERROR':
          return [
            { details: JSON.stringify({ emailAddress: 'inbox@archive.com', error: 'boom' }) },
            { details: JSON.stringify({ emailAddress: 'inbox@archive.com', error: 'boom2' }) },
            { details: JSON.stringify({ emailAddress: 'second@archive.com', error: 'boom3' }) },
          ];
        // Latest reconciliation runs; only mb-1 has one.
        case 'RECONCILIATION_RUN':
          return [
            {
              id: 'log-1',
              createdAt: new Date(now.getTime() - 30 * 60 * 1000),
              details: JSON.stringify({ mailboxId: 'mb-1', missingBefore: 3, ingested: 3 }),
            },
          ];
        default:
          return [];
      }
    });

    // mb-1 is active with recent mail; mb-2 is a quiet mailbox with nothing.
    mockPrisma.emailMessage.findFirst.mockImplementation(async ({ where }: Where = {}) =>
      where?.mailboxId === 'mb-1' ? { receivedAt: lastMsgAt } : null
    );
    mockPrisma.emailMessage.count.mockImplementation(async ({ where }: Where = {}) => {
      if (where?.mailboxId !== 'mb-1') return 0;
      return where.receivedAt ? 7 /* messagesLast24h */ : 42 /* totalMessages */;
    });
    mockPrisma.candidate.count.mockImplementation(async ({ where }: Where = {}) => {
      if (where?.mailboxId !== 'mb-1') return 0;
      return where.status === 'NEEDS_REVIEW' ? 1 : 5 /* totalCandidates */;
    });
    mockPrisma.emailDraft.count.mockImplementation(async ({ where }: Where = {}) => {
      const thread = where?.thread as { mailboxId?: string } | undefined;
      return where?.status === 'PENDING' && thread?.mailboxId === 'mb-1' ? 2 : 0;
    });

    const res = await request(app)
      .get('/api/internal/sync-health')
      .set('Authorization', AUTH);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(2);

    const health1 = res.body.data.find(
      (m: { mailboxId: string }) => m.mailboxId === 'mb-1'
    );
    expect(health1).toMatchObject({
      mailboxId: 'mb-1',
      emailAddress: 'inbox@archive.com',
      displayName: 'Inbox',
      isActive: true,
      messagesLast24h: 7,
      pendingDrafts: 2,
      candidatesNeedsReview: 1,
      lastReconciliationFoundMissing: 3,
      webhookErrorsLast24h: 2,
      lastWebhookError: 'boom',
    });
    expect(health1.totalMessages).toBe(42);
    expect(health1.totalCandidates).toBe(5);
    expect(typeof health1.watchExpiry).toBe('string');
    expect(typeof health1.watchExpiresInHours).toBe('number');
    expect(health1.lastSyncedMessageAt).toBe(lastMsgAt.toISOString());
    expect(typeof health1.lastReconciliationAt).toBe('string');

    const health2 = res.body.data.find(
      (m: { mailboxId: string }) => m.mailboxId === 'mb-2'
    );
    expect(health2).toMatchObject({
      mailboxId: 'mb-2',
      emailAddress: 'second@archive.com',
      displayName: null,
      isActive: false,
      watchExpiry: null,
      watchExpiresInHours: null,
      lastSyncedMessageAt: null,
      lastReconciliationAt: null,
      lastReconciliationFoundMissing: 0,
      messagesLast24h: 0,
      pendingDrafts: 0,
      candidatesNeedsReview: 0,
      webhookErrorsLast24h: 1,
    });
  });
});
