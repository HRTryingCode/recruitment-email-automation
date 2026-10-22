// Audit B6 / H8: retention for bodies of messages on threads that never
// became candidate threads. Destructive; the cron is a no-op until
// ORPHAN_BODY_RETENTION_DAYS is set.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildPrismaMock, resetPrismaMock, type MockPrisma } from '../_setup/mockPrisma';

vi.mock('../../src/db/client', () => {
  const prisma = buildPrismaMock();
  return { prisma, default: prisma };
});

import { prisma as injectedPrisma } from '../../src/db/client';
import {
  purgeOrphanBodies,
  orphanBodyWhere,
  retentionDaysFromEnv,
} from '../../src/services/retention.service';
const mockPrisma = injectedPrisma as unknown as MockPrisma;

describe('orphanBodyWhere', () => {
  it('targets only unlinked threads, older than the cutoff, that still have a body', () => {
    const cutoff = new Date('2026-09-01T00:00:00Z');
    expect(orphanBodyWhere(cutoff)).toEqual({
      receivedAt: { lt: cutoff },
      thread: { candidateId: null },
      OR: [{ bodyText: { not: null } }, { bodyHtml: { not: null } }],
    });
  });
});

describe('purgeOrphanBodies', () => {
  beforeEach(() => resetPrismaMock(mockPrisma));

  it('dry run counts and writes nothing', async () => {
    mockPrisma.emailMessage.count.mockResolvedValueOnce(18691);
    const res = await purgeOrphanBodies({ olderThanDays: 30, dryRun: true });
    expect(res).toMatchObject({ matched: 18691, purged: 0, dryRun: true });
    expect(mockPrisma.emailMessage.updateMany).not.toHaveBeenCalled();
  });

  it('purges in id batches, nulling only bodyText/bodyHtml', async () => {
    mockPrisma.emailMessage.count.mockResolvedValueOnce(3);
    mockPrisma.emailMessage.findMany
      .mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }])
      .mockResolvedValueOnce([{ id: 'c' }])
      .mockResolvedValueOnce([]);
    mockPrisma.emailMessage.updateMany
      .mockResolvedValueOnce({ count: 2 })
      .mockResolvedValueOnce({ count: 1 });

    const res = await purgeOrphanBodies({ olderThanDays: 30, dryRun: false, batchSize: 2 });

    expect(res).toMatchObject({ matched: 3, purged: 3, dryRun: false, complete: true });
    const first = mockPrisma.emailMessage.updateMany.mock.calls[0]![0];
    expect(first.data).toEqual({ bodyText: null, bodyHtml: null });
    // Re-applies the orphan filter so a thread linked mid-run is not touched.
    expect(first.where.id).toEqual({ in: ['a', 'b'] });
    expect(first.where.thread).toEqual({ candidateId: null });
  });

  it('stops at the deadline and reports incomplete', async () => {
    mockPrisma.emailMessage.count.mockResolvedValueOnce(10);
    mockPrisma.emailMessage.findMany.mockResolvedValue([{ id: 'a' }]);
    mockPrisma.emailMessage.updateMany.mockResolvedValue({ count: 1 });
    const res = await purgeOrphanBodies({
      olderThanDays: 30,
      dryRun: false,
      batchSize: 1,
      deadline: Date.now() - 1,
    });
    expect(res.complete).toBe(false);
    expect(mockPrisma.emailMessage.updateMany).not.toHaveBeenCalled();
  });

  it('refuses a retention window under 7 days', async () => {
    await expect(purgeOrphanBodies({ olderThanDays: 1, dryRun: true })).rejects.toThrow(/at least 7/);
  });
});

describe('retentionDaysFromEnv', () => {
  it.each([
    [undefined, null],
    ['', null],
    ['abc', null],
    ['3', null],
    ['30', 30],
    ['90', 90],
  ])('%s → %s', (raw, expected) => {
    expect(retentionDaysFromEnv(raw)).toBe(expected);
  });
});
