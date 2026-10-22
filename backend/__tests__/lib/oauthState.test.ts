import { describe, it, expect, beforeEach, vi } from 'vitest';

import { buildPrismaMock, resetPrismaMock, type MockPrisma } from '../_setup/mockPrisma';

vi.mock('../../src/db/client', () => {
  const prisma = buildPrismaMock();
  return { prisma, default: prisma };
});

import { prisma as injectedPrisma } from '../../src/db/client';
import { storeOAuthState, consumeOAuthState, createOAuthState } from '../../src/lib/oauthState';

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

  describe('createOAuthState (L6: bound to the initiating user)', () => {
    it('stores and returns a random state that carries the user id', async () => {
      const a = await createOAuthState('user_abc123');
      const b = await createOAuthState('user_abc123');
      expect(a).toMatch(/^[0-9a-f]{64}\.user_abc123$/);
      expect(a).not.toBe(b);
      expect(mockPrisma.oAuthState.create).toHaveBeenCalledWith({ data: { state: a } });
    });
  });

  describe('consumeOAuthState (atomic, L6)', () => {
    it('consumes with a single conditional updateMany and returns the bound user id', async () => {
      mockPrisma.oAuthState.updateMany.mockResolvedValueOnce({ count: 1 });
      const state = `${'a'.repeat(64)}.user_abc123`;

      const result = await consumeOAuthState(state);

      expect(result).toEqual({ userId: 'user_abc123' });
      expect(mockPrisma.oAuthState.findUnique).not.toHaveBeenCalled();
      const args = mockPrisma.oAuthState.updateMany.mock.calls[0]?.[0] as {
        where: { state: string; consumedAt: null; createdAt: { gte: Date } };
        data: { consumedAt: Date };
      };
      expect(args.where.state).toBe(state);
      expect(args.where.consumedAt).toBeNull();
      const expectedCutoff = Date.now() - OAUTH_STATE_TTL_MS;
      expect(Math.abs(args.where.createdAt.gte.getTime() - expectedCutoff)).toBeLessThan(5_000);
      expect(args.data.consumedAt).toBeInstanceOf(Date);
    });

    it('returns null when no row matched (unknown, expired or already consumed)', async () => {
      mockPrisma.oAuthState.updateMany.mockResolvedValueOnce({ count: 0 });
      expect(await consumeOAuthState('never-stored')).toBeNull();
    });

    it('concurrent consumes of the same state: exactly one wins', async () => {
      mockPrisma.oAuthState.updateMany
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 0 });
      const state = `${'b'.repeat(64)}.u1`;
      const results = await Promise.all([consumeOAuthState(state), consumeOAuthState(state)]);
      expect(results.filter(Boolean)).toHaveLength(1);
    });

    it('a legacy state without a user suffix consumes with userId null', async () => {
      mockPrisma.oAuthState.updateMany.mockResolvedValueOnce({ count: 1 });
      expect(await consumeOAuthState('c'.repeat(64))).toEqual({ userId: null });
    });
  });
});
