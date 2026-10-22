import { describe, it, expect, beforeEach, vi } from 'vitest';

// M26: SystemLog retention. Deleting is a destructive prod write, so the job
// is a dry run (counts only) unless explicitly enabled.

const prisma = vi.hoisted(() => ({
  systemLog: { count: vi.fn() },
  $executeRaw: vi.fn(),
}));

vi.mock('../../src/db/client', () => ({ prisma, default: prisma }));

import { pruneSystemLog, SYSTEMLOG_RETENTION } from '../../src/services/systemLogRetention.service';

const NOW = new Date('2026-10-22T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

describe('pruneSystemLog', () => {
  beforeEach(() => {
    prisma.systemLog.count.mockReset();
    prisma.$executeRaw.mockReset();
  });

  it('keeps 30 days of INFO and 90 days of everything else', () => {
    expect(SYSTEMLOG_RETENTION).toEqual({ infoDays: 30, otherDays: 90 });
  });

  it('dry run: counts what would be deleted and deletes nothing', async () => {
    prisma.systemLog.count.mockResolvedValueOnce(500_000).mockResolvedValueOnce(1_200);

    const result = await pruneSystemLog({ enabled: false, now: NOW });

    expect(result).toEqual({ enabled: false, deleted: 0, wouldDelete: { info: 500_000, other: 1_200 } });
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
    expect(prisma.systemLog.count).toHaveBeenNthCalledWith(1, {
      where: { level: 'INFO', createdAt: { lt: new Date(NOW.getTime() - 30 * DAY) } },
    });
    expect(prisma.systemLog.count).toHaveBeenNthCalledWith(2, {
      where: { level: { not: 'INFO' }, createdAt: { lt: new Date(NOW.getTime() - 90 * DAY) } },
    });
  });

  it('enabled: deletes in batches until a short batch, INFO then the rest', async () => {
    prisma.$executeRaw
      .mockResolvedValueOnce(5_000) // INFO batch 1 (full)
      .mockResolvedValueOnce(1_000) // INFO batch 2 (short → done)
      .mockResolvedValueOnce(42); // other batch 1 (short → done)

    const result = await pruneSystemLog({ enabled: true, now: NOW, batchSize: 5_000 });

    expect(result).toEqual({ enabled: true, deleted: 6_042, complete: true });
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(3);
  });

  it('enabled: stops at the deadline and reports incomplete', async () => {
    prisma.$executeRaw.mockResolvedValue(5_000);
    const result = await pruneSystemLog({ enabled: true, now: NOW, batchSize: 5_000, deadline: Date.now() - 1 });
    expect(result).toMatchObject({ enabled: true, deleted: 0, complete: false });
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });
});
