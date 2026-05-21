import { describe, it, expect, beforeEach, vi } from 'vitest';

import { buildPrismaMock, resetPrismaMock, type MockPrisma } from '../_setup/mockPrisma';

vi.mock('../../src/db/client', () => {
  const prisma = buildPrismaMock();
  return { prisma, default: prisma };
});

import { prisma as injectedPrisma } from '../../src/db/client';
import { storeOAuthState, consumeOAuthState } from '../../src/lib/oauthState';

const mockPrisma = injectedPrisma as unknown as MockPrisma;
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

describe('lib/oauthState (Prisma-backed)', () => {
  beforeEach(() => {
    resetPrismaMock(mockPrisma);
  });

  describe('storeOAuthState', () => {
    it('reaps stale rows then inserts the new state', async () => {
      await storeOAuthState('tok-1');

      expect(mockPrisma.oAuthState.deleteMany).toHaveBeenCalledTimes(1);
      const reaperArgs = mockPrisma.oAuthState.deleteMany.mock.calls[0]?.[0] as {
        where: { createdAt: { lt: Date } };
      };
      expect(reaperArgs.where.createdAt.lt).toBeInstanceOf(Date);
      // Reaper cutoff is ~now - TTL; allow a generous slop for slow CI.
      const expectedCutoff = Date.now() - OAUTH_STATE_TTL_MS;
      expect(reaperArgs.where.createdAt.lt.getTime()).toBeGreaterThan(expectedCutoff - 5_000);
      expect(reaperArgs.where.createdAt.lt.getTime()).toBeLessThan(expectedCutoff + 5_000);

      expect(mockPrisma.oAuthState.create).toHaveBeenCalledWith({ data: { state: 'tok-1' } });
    });

    it('still inserts when the reaper deleteMany fails (non-fatal)', async () => {
      mockPrisma.oAuthState.deleteMany.mockRejectedValueOnce(new Error('boom'));
      await expect(storeOAuthState('tok-2')).resolves.toBeUndefined();
      expect(mockPrisma.oAuthState.create).toHaveBeenCalledWith({ data: { state: 'tok-2' } });
    });
  });

  describe('consumeOAuthState', () => {
    it('returns true and marks consumedAt on a fresh, unconsumed row', async () => {
      mockPrisma.oAuthState.findUnique.mockResolvedValueOnce({
        state: 'tok-3',
        mailboxId: null,
        createdAt: new Date(Date.now() - 1_000),
        consumedAt: null,
      });

      const result = await consumeOAuthState('tok-3');

      expect(result).toBe(true);
      expect(mockPrisma.oAuthState.update).toHaveBeenCalledTimes(1);
      const updateArgs = mockPrisma.oAuthState.update.mock.calls[0]?.[0] as {
        where: { state: string };
        data: { consumedAt: Date };
      };
      expect(updateArgs.where).toEqual({ state: 'tok-3' });
      expect(updateArgs.data.consumedAt).toBeInstanceOf(Date);
    });

    it('returns false for an unknown state', async () => {
      mockPrisma.oAuthState.findUnique.mockResolvedValueOnce(null);
      expect(await consumeOAuthState('never-stored')).toBe(false);
      expect(mockPrisma.oAuthState.update).not.toHaveBeenCalled();
    });

    it('rejects a state that has already been consumed (replay protection)', async () => {
      mockPrisma.oAuthState.findUnique.mockResolvedValueOnce({
        state: 'tok-4',
        mailboxId: null,
        createdAt: new Date(Date.now() - 1_000),
        consumedAt: new Date(Date.now() - 500),
      });

      expect(await consumeOAuthState('tok-4')).toBe(false);
      expect(mockPrisma.oAuthState.update).not.toHaveBeenCalled();
    });

    it('rejects a state older than the 10-minute TTL', async () => {
      mockPrisma.oAuthState.findUnique.mockResolvedValueOnce({
        state: 'tok-5',
        mailboxId: null,
        createdAt: new Date(Date.now() - (OAUTH_STATE_TTL_MS + 1_000)),
        consumedAt: null,
      });

      expect(await consumeOAuthState('tok-5')).toBe(false);
      expect(mockPrisma.oAuthState.update).not.toHaveBeenCalled();
    });

    it('two consumes of the same state: happy path then replay rejection', async () => {
      // First call: unconsumed → returns true and the route would mark consumedAt.
      mockPrisma.oAuthState.findUnique.mockResolvedValueOnce({
        state: 'tok-6',
        mailboxId: null,
        createdAt: new Date(Date.now() - 1_000),
        consumedAt: null,
      });
      expect(await consumeOAuthState('tok-6')).toBe(true);

      // Second call: the row now has consumedAt set → reject.
      mockPrisma.oAuthState.findUnique.mockResolvedValueOnce({
        state: 'tok-6',
        mailboxId: null,
        createdAt: new Date(Date.now() - 1_000),
        consumedAt: new Date(),
      });
      expect(await consumeOAuthState('tok-6')).toBe(false);
    });
  });
});
