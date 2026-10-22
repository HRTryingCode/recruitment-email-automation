import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildPrismaMock, resetPrismaMock, type MockPrisma } from '../_setup/mockPrisma';

vi.mock('../../src/db/client', () => {
  const prisma = buildPrismaMock();
  return { prisma, default: prisma };
});

import { prisma as injected } from '../../src/db/client';
import { leverColumns, refreshCandidateLever, syncStaleLever } from '../../src/services/leverSync.service';
import type { LeverStatus } from '../../src/services/lever.service';

const mockPrisma = injected as unknown as MockPrisma;

const NOW = new Date('2026-10-22T12:00:00.000Z');

function status(state: LeverStatus['state'], extra: Partial<LeverStatus> = {}): LeverStatus {
  const primary =
    state === 'ACTIVE' || state === 'ARCHIVED' || state === 'HIRED'
      ? {
          id: 'opp1',
          postingId: 'post-1',
  postingTitle: 'Founding Engineer',
          stage: 'Interest Call',
          archived: state !== 'ACTIVE',
          hired: state === 'HIRED',
          archivedReason: state === 'ARCHIVED' ? 'Underqualified' : state === 'HIRED' ? 'Hired' : null,
          createdAt: null,
          updatedAt: null,
          leverUrl: 'https://hire.lever.co/candidates/opp1',
        }
      : null;
  return { state, primary, opportunities: primary ? [primary] : [], checkedAt: NOW.toISOString(), ...extra };
}

function fakeClient(byEmail: Record<string, LeverStatus>, configured = true) {
  return {
    configured,
    findByEmail: vi.fn(async (e: string) => byEmail[e] ?? status('NOT_FOUND')),
  };
}

beforeEach(() => {
  resetPrismaMock(mockPrisma);
  mockPrisma.candidate.update.mockResolvedValue({});
});

describe('leverColumns', () => {
  it('maps an active status', () => {
    expect(leverColumns(status('ACTIVE'))).toEqual({
      leverState: 'ACTIVE',
      leverOpportunityId: 'opp1',
      leverPostingTitle: 'Founding Engineer',
      leverStage: 'Interest Call',
      leverArchivedReason: null,
      leverCheckedAt: NOW,
      leverError: null,
    });
  });

  it('clears opportunity fields for NOT_FOUND and records the reason for ERROR', () => {
    expect(leverColumns(status('NOT_FOUND'))).toMatchObject({ leverState: 'NOT_FOUND', leverOpportunityId: null });
    expect(leverColumns(status('ERROR', { reason: 'http_503' }))).toMatchObject({
      leverState: 'ERROR',
      leverError: 'http_503',
      leverOpportunityId: null,
    });
  });
});

describe('refreshCandidateLever', () => {
  it('looks up by the candidate email and persists the columns', async () => {
    mockPrisma.candidate.findUnique.mockResolvedValueOnce({ id: 'c1', email: 'a@b.com' });
    mockPrisma.candidate.update.mockResolvedValueOnce({ id: 'c1', leverState: 'ACTIVE' });
    const client = fakeClient({ 'a@b.com': status('ACTIVE') });
    const out = await refreshCandidateLever('c1', client);
    expect(client.findByEmail).toHaveBeenCalledWith('a@b.com');
    expect(mockPrisma.candidate.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: expect.objectContaining({ leverState: 'ACTIVE', leverStage: 'Interest Call' }),
    });
    expect(out?.status.state).toBe('ACTIVE');
  });

  it('returns null for an unknown candidate', async () => {
    mockPrisma.candidate.findUnique.mockResolvedValueOnce(null);
    expect(await refreshCandidateLever('nope', fakeClient({}))).toBeNull();
    expect(mockPrisma.candidate.update).not.toHaveBeenCalled();
  });
});

describe('syncStaleLever', () => {
  it('skips without touching candidates when Lever is unconfigured', async () => {
    const out = await syncStaleLever({ client: fakeClient({}, false), deadline: Date.now() + 10_000 });
    expect(out).toMatchObject({ skipped: true, reason: 'unconfigured', checked: 0 });
    expect(mockPrisma.candidate.findMany).not.toHaveBeenCalled();
  });

  it('selects never-checked or >3h-stale candidates, oldest first', async () => {
    mockPrisma.candidate.findMany.mockResolvedValueOnce([]);
    await syncStaleLever({ client: fakeClient({}), deadline: Date.now() + 10_000, now: () => NOW.getTime() });
    const arg = mockPrisma.candidate.findMany.mock.calls[0]![0];
    expect(arg.where).toEqual({
      OR: [{ leverCheckedAt: null }, { leverCheckedAt: { lt: new Date(NOW.getTime() - 3 * 3600_000) } }],
    });
    expect(arg.orderBy).toEqual([{ leverCheckedAt: { sort: 'asc', nulls: 'first' } }, { createdAt: 'asc' }]);
    expect(arg.select).toEqual({ id: true, email: true });
  });

  it('refreshes each candidate and counts states', async () => {
    mockPrisma.candidate.findMany.mockResolvedValueOnce([
      { id: 'c1', email: 'a@x.com' },
      { id: 'c2', email: 'b@x.com' },
      { id: 'c3', email: 'c@x.com' },
    ]);
    const client = fakeClient({
      'a@x.com': status('ACTIVE'),
      'b@x.com': status('ERROR', { reason: 'http_500' }),
    });
    const out = await syncStaleLever({ client, deadline: Date.now() + 10_000 });
    expect(out).toMatchObject({
      skipped: false,
      candidates: 3,
      checked: 3,
      errors: 1,
      deadlineReached: false,
      byState: { ACTIVE: 1, ERROR: 1, NOT_FOUND: 1 },
    });
    expect(mockPrisma.candidate.update).toHaveBeenCalledTimes(3);
  });

  it('stops starting new candidates once the deadline passes', async () => {
    mockPrisma.candidate.findMany.mockResolvedValueOnce([
      { id: 'c1', email: 'a@x.com' },
      { id: 'c2', email: 'b@x.com' },
    ]);
    let t = 0;
    const client = fakeClient({});
    client.findByEmail.mockImplementation(async () => {
      t += 100;
      return status('NOT_FOUND');
    });
    const out = await syncStaleLever({ client, deadline: 50, now: () => t, concurrency: 1 });
    expect(out.checked).toBe(1);
    expect(out.deadlineReached).toBe(true);
  });

  it('aborts after repeated consecutive errors (e.g. revoked key)', async () => {
    mockPrisma.candidate.findMany.mockResolvedValueOnce(
      Array.from({ length: 20 }, (_, i) => ({ id: `c${i}`, email: `${i}@x.com` }))
    );
    const client = fakeClient({});
    client.findByEmail.mockResolvedValue(status('ERROR', { reason: 'http_401' }));
    const out = await syncStaleLever({ client, deadline: Date.now() + 10_000, concurrency: 1 });
    expect(out.aborted).toBe(true);
    expect(out.checked).toBe(5);
  });
});
