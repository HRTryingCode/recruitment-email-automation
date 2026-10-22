import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildPrismaMock, resetPrismaMock, type MockPrisma } from '../_setup/mockPrisma';

vi.mock('../../src/db/client', () => {
  const prisma = buildPrismaMock();
  return { prisma, default: prisma };
});

import { prisma as injectedPrisma } from '../../src/db/client';
import {
  PRESENCE_STALE_MS,
  heartbeatPresence,
  clearPresence,
  listPresence,
  findLockHolder,
} from '../../src/services/draftPresence.service';
const mockPrisma = injectedPrisma as unknown as MockPrisma;

const NOW = new Date('2026-10-22T15:00:00Z');

/** Rows as Postgres would store them; findMany applies the same filters the service asks for. */
function installRows(rows: Array<{ draftId: string; userId: string; mode: string; ageMs: number; name?: string | null }>) {
  mockPrisma.draftPresence.findMany.mockImplementation(async ({ where }) => {
    return rows
      .map((r) => ({
        draftId: r.draftId,
        userId: r.userId,
        mode: r.mode,
        heartbeatAt: new Date(NOW.getTime() - r.ageMs),
        user: { name: r.name === undefined ? `Name ${r.userId}` : r.name, email: `${r.userId}@archive.com` },
      }))
      .filter((r) => where.draftId.in.includes(r.draftId))
      .filter((r) => r.heartbeatAt.getTime() >= where.heartbeatAt.gte.getTime())
      .filter((r) => !where.userId || r.userId !== where.userId.not);
  });
}

describe('draftPresence.service (U0)', () => {
  beforeEach(() => resetPrismaMock(mockPrisma));

  it('treats heartbeats older than 45s as gone', () => {
    expect(PRESENCE_STALE_MS).toBe(45_000);
  });

  it('heartbeat upserts the (draft, user) row with a fresh timestamp', async () => {
    mockPrisma.draftPresence.upsert.mockResolvedValue({});
    mockPrisma.draftPresence.deleteMany.mockResolvedValue({ count: 0 });
    await heartbeatPresence('d1', 'u1', 'editing', NOW);
    expect(mockPrisma.draftPresence.upsert).toHaveBeenCalledWith({
      where: { draftId_userId: { draftId: 'd1', userId: 'u1' } },
      create: { draftId: 'd1', userId: 'u1', mode: 'editing', heartbeatAt: NOW },
      update: { mode: 'editing', heartbeatAt: NOW },
    });
  });

  it('clearPresence removes only this user on this draft', async () => {
    mockPrisma.draftPresence.deleteMany.mockResolvedValue({ count: 1 });
    await clearPresence('d1', 'u1');
    expect(mockPrisma.draftPresence.deleteMany).toHaveBeenCalledWith({ where: { draftId: 'd1', userId: 'u1' } });
  });

  it('lists fresh presence per draft, excluding the caller and stale rows', async () => {
    installRows([
      { draftId: 'd1', userId: 'me', mode: 'editing', ageMs: 1000 },
      { draftId: 'd1', userId: 'u2', mode: 'viewing', ageMs: 10_000 },
      { draftId: 'd1', userId: 'u3', mode: 'editing', ageMs: 50_000 },
      { draftId: 'd2', userId: 'u4', mode: 'editing', ageMs: 0, name: null },
    ]);
    const map = await listPresence(['d1', 'd2'], 'me', NOW);
    expect(map.get('d1')).toEqual([{ userId: 'u2', name: 'Name u2', mode: 'viewing' }]);
    // Falls back to the email when the user has no display name.
    expect(map.get('d2')).toEqual([{ userId: 'u4', name: 'u4@archive.com', mode: 'editing' }]);
  });

  it('no query for an empty id list', async () => {
    expect((await listPresence([], 'me', NOW)).size).toBe(0);
    expect(mockPrisma.draftPresence.findMany).not.toHaveBeenCalled();
  });

  describe('findLockHolder', () => {
    it('someone else editing (fresh) holds the lock', async () => {
      installRows([{ draftId: 'd1', userId: 'u2', mode: 'editing', ageMs: 5000, name: 'Sofia Delgado' }]);
      await expect(findLockHolder('d1', 'me', NOW)).resolves.toEqual({ userId: 'u2', name: 'Sofia Delgado' });
    });

    it('my own editing presence never locks me out', async () => {
      installRows([{ draftId: 'd1', userId: 'me', mode: 'editing', ageMs: 0 }]);
      await expect(findLockHolder('d1', 'me', NOW)).resolves.toBeNull();
    });

    it('viewing does not lock', async () => {
      installRows([{ draftId: 'd1', userId: 'u2', mode: 'viewing', ageMs: 0 }]);
      await expect(findLockHolder('d1', 'me', NOW)).resolves.toBeNull();
    });

    it('a stale editing heartbeat does not lock', async () => {
      installRows([{ draftId: 'd1', userId: 'u2', mode: 'editing', ageMs: PRESENCE_STALE_MS + 1 }]);
      await expect(findLockHolder('d1', 'me', NOW)).resolves.toBeNull();
    });
  });
});
