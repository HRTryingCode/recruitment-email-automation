// H2: a new or re-emailed candidate gets its Lever status within seconds,
// in the background (waitUntil), never blocking or failing the caller.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildPrismaMock, resetPrismaMock, type MockPrisma } from '../_setup/mockPrisma';

vi.mock('../../src/db/client', () => {
  const prisma = buildPrismaMock();
  return { prisma, default: prisma };
});

const { waitUntil } = vi.hoisted(() => ({ waitUntil: vi.fn() }));
vi.mock('@vercel/functions', () => ({ waitUntil }));

import { prisma as injected } from '../../src/db/client';
import { scheduleLeverRefresh } from '../../src/services/leverRealtime.service';

const mockPrisma = injected as unknown as MockPrisma;
const client = { configured: true, findByEmail: vi.fn() };

beforeEach(() => {
  resetPrismaMock(mockPrisma);
  waitUntil.mockReset();
  mockPrisma.systemLog.create.mockResolvedValue({});
});

describe('scheduleLeverRefresh', () => {
  it('registers the refresh with waitUntil and runs it for that candidate', async () => {
    const refresh = vi.fn().mockResolvedValue({ candidate: {}, status: {} });
    scheduleLeverRefresh('cand-1', 'created', { client, refresh });
    expect(waitUntil).toHaveBeenCalledTimes(1);
    await waitUntil.mock.calls[0]![0];
    expect(refresh).toHaveBeenCalledWith('cand-1', client);
  });

  it('swallows a failed refresh and logs LEVER_REFRESH_FAILED without the error stack', async () => {
    const refresh = vi.fn().mockRejectedValue(new Error('db down'));
    expect(() => scheduleLeverRefresh('cand-1', 'email_changed', { client, refresh })).not.toThrow();
    await expect(waitUntil.mock.calls[0]![0]).resolves.toBeUndefined();
    const log = mockPrisma.systemLog.create.mock.calls[0]![0].data;
    expect(log.event).toBe('LEVER_REFRESH_FAILED');
    expect(log.level).toBe('WARN');
    expect(JSON.parse(log.details)).toEqual({ candidateId: 'cand-1', reason: 'email_changed', error: 'db down' });
  });

  it('does nothing when Lever is not configured (no ERROR row written onto a fresh candidate)', () => {
    const refresh = vi.fn();
    scheduleLeverRefresh('cand-1', 'created', { client: { ...client, configured: false }, refresh });
    expect(waitUntil).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });
});
