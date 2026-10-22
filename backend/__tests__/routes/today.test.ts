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
const MB = 'cmb0000000000000000000001';

describe('GET /api/today (R4)', () => {
  let app: Awaited<ReturnType<typeof loadApp>>;
  beforeEach(async () => {
    resetPrismaMock(mockPrisma);
    // inbox, messages, sent, lever — in that order.
    mockPrisma.$queryRaw
      .mockResolvedValueOnce([
        { view: 'interested', mailboxId: MB, count: 2, oldestAt: new Date('2026-10-20T10:00:00Z'), expiringSoon: 1 },
        { view: 'sent_today', mailboxId: MB, count: 3, oldestAt: null, expiringSoon: 0 },
      ])
      .mockResolvedValueOnce([{ kind: 'mailbox', mailboxId: MB, day: null, at: new Date('2026-10-22T09:00:00Z'), count: 0 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ interestedNotInLever: 4, addedToday: 1, addedThisWeek: 2 }]);
    app = await loadApp();
  });

  it('401 without auth', async () => {
    expect((await request(app).get('/api/today')).status).toBe(401);
    expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('400 for a malformed mailboxId', async () => {
    const res = await request(app).get('/api/today?mailboxId=../../etc').set('Authorization', AUTH);
    expect(res.status).toBe(400);
    expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('returns the summary in at most four queries and writes nothing', async () => {
    const res = await request(app).get(`/api/today?mailboxId=${MB}`).set('Authorization', AUTH);
    expect(res.status).toBe(200);
    expect(mockPrisma.$queryRaw.mock.calls.length).toBeLessThanOrEqual(4);
    expect(mockPrisma.emailDraft.updateMany).not.toHaveBeenCalled();
    expect(res.body.data).toMatchObject({
      views: { needs_review: 0, interested: 2, not_interested: 0 },
      sentToday: 3,
      oldestWaitingAt: '2026-10-20T10:00:00.000Z',
      draftsExpiringSoon: 1,
      mailboxes: [{ mailboxId: MB, waiting: 2, sentToday: 3, lastReceivedAt: '2026-10-22T09:00:00.000Z' }],
      lever: { interestedNotInLever: 4, addedToday: 1, addedThisWeek: 2 },
    });
    expect(res.body.data.series).toHaveLength(14);
  });
});
