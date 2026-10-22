import { describe, it, expect, beforeEach, vi } from 'vitest';

import { buildPrismaMock, resetPrismaMock, type MockPrisma } from '../_setup/mockPrisma';

vi.mock('../../src/db/client', () => {
  const prisma = buildPrismaMock();
  return { prisma, default: prisma };
});

import { prisma as injectedPrisma } from '../../src/db/client';
import { findBlockingDraft } from '../../src/services/gmail.service';
const mockPrisma = injectedPrisma as unknown as MockPrisma;

describe('findBlockingDraft (M23 dedup)', () => {
  beforeEach(() => resetPrismaMock(mockPrisma));

  it('blocks on a live PENDING/APPROVED draft for any inbox', async () => {
    mockPrisma.emailDraft.findFirst.mockResolvedValue({ id: 'd1', status: 'PENDING' });
    await expect(findBlockingDraft('t1', false)).resolves.toEqual({ id: 'd1', status: 'PENDING' });
    expect(mockPrisma.emailDraft.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { threadId: 't1', status: { in: ['PENDING', 'APPROVED'] } } })
    );
  });

  it('on a hand-off inbox, also blocks once a hand-off was already SENT on the thread', async () => {
    mockPrisma.emailDraft.findFirst.mockResolvedValue({ id: 'd0', status: 'SENT' });
    await expect(findBlockingDraft('t1', true)).resolves.toEqual({ id: 'd0', status: 'SENT' });
    expect(mockPrisma.emailDraft.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { threadId: 't1', status: { in: ['PENDING', 'APPROVED', 'SENT'] } } })
    );
  });

  it('returns null when nothing blocks', async () => {
    mockPrisma.emailDraft.findFirst.mockResolvedValue(null);
    await expect(findBlockingDraft('t1', true)).resolves.toBeNull();
  });
});
