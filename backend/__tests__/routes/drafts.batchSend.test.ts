import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';

import { buildPrismaMock, resetPrismaMock, type MockPrisma } from '../_setup/mockPrisma';
import { loadApp, bearer } from '../_setup/testApp';

const { waitUntil, runDelayedSendBatch } = vi.hoisted(() => ({ waitUntil: vi.fn(), runDelayedSendBatch: vi.fn() }));
vi.mock('@vercel/functions', () => ({ waitUntil }));
vi.mock('../../src/services/draftSend.service', async () => {
  const actual = await vi.importActual<typeof import('../../src/services/draftSend.service')>(
    '../../src/services/draftSend.service'
  );
  return { ...actual, runDelayedSendBatch };
});
vi.mock('../../src/db/client', () => {
  const prisma = buildPrismaMock();
  return { prisma, default: prisma };
});

import { prisma as injectedPrisma } from '../../src/db/client';
const mockPrisma = injectedPrisma as unknown as MockPrisma;
const ME = 'test-user-1';
const AUTH = bearer(ME);

const id = (n: number) => `ckdraft${String(n).padStart(18, '0')}`;
const row = (n: number, over: Record<string, unknown> = {}) => ({
  id: id(n),
  status: 'PENDING',
  classification: 'NOT_INTERESTED',
  thread: { candidate: { id: `cand-${n}` } },
  ...over,
});

describe('POST /api/drafts/batch-send', () => {
  let app: Awaited<ReturnType<typeof loadApp>>;
  beforeEach(async () => {
    resetPrismaMock(mockPrisma);
    waitUntil.mockReset();
    runDelayedSendBatch.mockReset().mockResolvedValue(undefined);
    mockPrisma.emailDraft.updateMany.mockResolvedValue({ count: 1 });
    app = await loadApp();
  });

  it('schedules each eligible draft and reports every skip with a reason', async () => {
    mockPrisma.emailDraft.findMany.mockResolvedValue([
      row(1),
      row(2),
      row(3, { classification: 'INTERESTED' }),
      row(4, { status: 'SENT' }),
      row(5, { thread: { candidate: null } }),
      row(6),
    ]);
    mockPrisma.draftPresence.findMany.mockResolvedValue([
      { draftId: id(6), userId: 'u-2', mode: 'editing', heartbeatAt: new Date(), user: { name: 'Sofia', email: 's@a.com' } },
    ]);
    const res = await request(app)
      .post('/api/drafts/batch-send')
      .set('Authorization', AUTH)
      .send({ draftIds: [id(1), id(2), id(3), id(4), id(5), id(6), id(7)], undoSeconds: 15 });

    expect(res.status).toBe(202);
    expect(res.body.data.scheduled).toEqual([id(1), id(2)]);
    expect(res.body.data.skipped).toEqual([
      { id: id(3), reason: 'not_batchable' },
      { id: id(4), reason: 'not_pending' },
      { id: id(5), reason: 'no_candidate' },
      { id: id(6), reason: 'locked', lockedBy: 'Sofia' },
      { id: id(7), reason: 'not_found' },
    ]);
    // Each one is a compare-and-set PENDING → SCHEDULED with the same send time.
    expect(mockPrisma.emailDraft.updateMany).toHaveBeenCalledTimes(2);
    expect(mockPrisma.emailDraft.updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: id(1), status: 'PENDING' },
      data: { status: 'SCHEDULED', sentByUserId: ME },
    });
    expect(runDelayedSendBatch).toHaveBeenCalledWith([id(1), id(2)], 15_000);
    expect(waitUntil).toHaveBeenCalledTimes(1);
  });

  it('reports a draft that changed concurrently instead of claiming it', async () => {
    mockPrisma.emailDraft.findMany.mockResolvedValue([row(1)]);
    mockPrisma.emailDraft.updateMany.mockResolvedValueOnce({ count: 0 });
    const res = await request(app).post('/api/drafts/batch-send').set('Authorization', AUTH).send({ draftIds: [id(1)] });
    expect(res.body.data).toMatchObject({ scheduled: [], skipped: [{ id: id(1), reason: 'not_pending' }] });
    expect(runDelayedSendBatch).not.toHaveBeenCalled();
  });

  it('caps a batch at 50', async () => {
    const draftIds = Array.from({ length: 51 }, (_, i) => id(i));
    const res = await request(app).post('/api/drafts/batch-send').set('Authorization', AUTH).send({ draftIds });
    expect(res.status).toBe(400);
    expect(mockPrisma.emailDraft.findMany).not.toHaveBeenCalled();
  });

  it('rejects an empty batch and an undo window over 30s', async () => {
    expect((await request(app).post('/api/drafts/batch-send').set('Authorization', AUTH).send({ draftIds: [] })).status).toBe(400);
    expect(
      (await request(app).post('/api/drafts/batch-send').set('Authorization', AUTH).send({ draftIds: [id(1)], undoSeconds: 60 })).status
    ).toBe(400);
  });
});
