import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildPrismaMock, resetPrismaMock, type MockPrisma } from '../_setup/mockPrisma';

const { waitUntil } = vi.hoisted(() => ({ waitUntil: vi.fn() }));
vi.mock('@vercel/functions', () => ({ waitUntil }));
vi.mock('../../src/db/client', () => {
  const prisma = buildPrismaMock();
  return { prisma, default: prisma };
});

import { prisma as injected } from '../../src/db/client';
import type { GemLookup } from '../../src/services/gem.service';
import {
  gemCacheState,
  gemEnrichmentDeps,
  persistGemEnrichment,
  pickGemUser,
  scheduleGemEnrichment,
  enrichCandidateFromGem,
  __resetGemEnrichmentState,
} from '../../src/services/gemEnrichment.service';

const mockPrisma = injected as unknown as MockPrisma;
const CAND = 'ckcand000000000000000001';
const OWNER = 'ckuser000000000000000001';
const ADMIN = 'ckuser000000000000000009';
const DAY = 24 * 60 * 60 * 1000;

const FOUND: GemLookup = {
  status: 'FOUND',
  person: {
    id: 'g-1',
    name: 'Jane Doe',
    title: 'Staff Engineer',
    company: 'Acme',
    location: 'Berlin',
    phone: '+49',
    linkedinUrl: 'https://www.linkedin.com/in/jane',
    resume: { url: 'https://s3.gem.test/r.pdf?sig=1', filename: 'cv.pdf', source: 'Upload' },
  },
};

const lookup = vi.fn<(userId: string, email: string, opts?: { extId?: string | null }) => Promise<GemLookup>>();

async function flush() {
  for (const call of waitUntil.mock.calls) await call[0];
}

beforeEach(() => {
  resetPrismaMock(mockPrisma);
  __resetGemEnrichmentState();
  waitUntil.mockReset();
  lookup.mockReset();
  gemEnrichmentDeps.lookup = lookup;
  mockPrisma.candidate.findUnique.mockResolvedValue({ id: CAND, email: 'jane@example.com', gemPersonId: null, linkedinUrl: null });
  mockPrisma.candidate.update.mockResolvedValue({});
  mockPrisma.candidate.updateMany.mockResolvedValue({ count: 1 });
  delete process.env.GEM_BACKGROUND_ENRICH;
});

describe('gemCacheState', () => {
  const now = Date.now();
  it('FOUND rows are fresh for 7 days, then stale', () => {
    expect(gemCacheState({ gemPersonId: 'g', gemFetchedAt: new Date(now - 6 * DAY) }, now)).toBe('fresh');
    expect(gemCacheState({ gemPersonId: 'g', gemFetchedAt: new Date(now - 8 * DAY) }, now)).toBe('stale');
  });
  it('NOT_FOUND rows are fresh for 24h, then looked up again', () => {
    expect(gemCacheState({ gemPersonId: null, gemFetchedAt: new Date(now - 2 * 60 * 60 * 1000) }, now)).toBe('fresh');
    expect(gemCacheState({ gemPersonId: null, gemFetchedAt: new Date(now - 2 * DAY) }, now)).toBe('missing');
  });
  it('never fetched → missing', () => {
    expect(gemCacheState({ gemPersonId: null, gemFetchedAt: null }, now)).toBe('missing');
    expect(gemCacheState(null, now)).toBe('missing');
  });
});

describe('persistGemEnrichment', () => {
  it('FOUND stores the cache columns + LinkedIn (only if empty), never the résumé URL or phone', async () => {
    await persistGemEnrichment(CAND, FOUND);
    const calls = [...mockPrisma.candidate.update.mock.calls, ...mockPrisma.candidate.updateMany.mock.calls];
    const all = JSON.stringify(calls);
    expect(all).not.toContain('s3.gem.test');
    expect(all).not.toContain('+49');
    expect(mockPrisma.candidate.update).toHaveBeenCalledWith({
      where: { id: CAND },
      data: expect.objectContaining({
        gemPersonId: 'g-1',
        gemTitle: 'Staff Engineer',
        gemCompany: 'Acme',
        gemLocation: 'Berlin',
        gemResumeAvailable: true,
        gemFetchedAt: expect.any(Date),
      }),
    });
    expect(mockPrisma.candidate.updateMany).toHaveBeenCalledWith({
      where: { id: CAND, linkedinUrl: null },
      data: { linkedinUrl: 'https://www.linkedin.com/in/jane' },
    });
  });

  it('NOT_FOUND clears the person and stamps the time; UNAVAILABLE / NOT_CONNECTED store nothing', async () => {
    await persistGemEnrichment(CAND, { status: 'NOT_FOUND' });
    expect(mockPrisma.candidate.update.mock.calls[0]![0].data).toMatchObject({ gemPersonId: null, gemFetchedAt: expect.any(Date) });
    mockPrisma.candidate.update.mockClear();
    await persistGemEnrichment(CAND, { status: 'UNAVAILABLE' });
    await persistGemEnrichment(CAND, { status: 'NOT_CONNECTED' });
    expect(mockPrisma.candidate.update).not.toHaveBeenCalled();
  });
});

describe('pickGemUser', () => {
  it('prefers the mailbox owner with an OK Gem connection', async () => {
    mockPrisma.user.findFirst.mockResolvedValueOnce({ id: OWNER });
    expect(await pickGemUser({ mailboxEmail: 'paul.b@archive.com' })).toBe(OWNER);
    expect(mockPrisma.user.findFirst.mock.calls[0]![0].where).toMatchObject({
      email: { equals: 'paul.b@archive.com', mode: 'insensitive' },
      gemConnection: { is: { status: 'OK', tokens: { not: null } } },
    });
  });
  it('falls back to any admin with an OK connection', async () => {
    mockPrisma.user.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: ADMIN });
    expect(await pickGemUser({ mailboxEmail: 'paul.b@archive.com' })).toBe(ADMIN);
    expect(mockPrisma.user.findFirst.mock.calls[1]![0].where).toMatchObject({ role: 'admin' });
  });
  it('null when nobody is connected', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(null);
    expect(await pickGemUser({ mailboxEmail: null })).toBeNull();
  });
});

describe('enrichCandidateFromGem / scheduleGemEnrichment', () => {
  it('looks the candidate up as the picked user and persists the result', async () => {
    mockPrisma.user.findFirst.mockResolvedValueOnce({ id: OWNER });
    lookup.mockResolvedValueOnce(FOUND);
    expect(await enrichCandidateFromGem(CAND, { mailboxEmail: 'paul.b@archive.com' })).toBe('found');
    expect(lookup).toHaveBeenCalledWith(OWNER, 'jane@example.com', { extId: null });
    expect(mockPrisma.candidate.update).toHaveBeenCalled();
  });

  it('skips silently when no Gem connection is available', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(null);
    expect(await enrichCandidateFromGem(CAND, {})).toBe('skipped');
    expect(lookup).not.toHaveBeenCalled();
  });

  it('a stale refresh reuses the cached Gem person id (skips search)', async () => {
    mockPrisma.candidate.findUnique.mockResolvedValueOnce({ id: CAND, email: 'jane@example.com', gemPersonId: 'g-1', linkedinUrl: null });
    lookup.mockResolvedValueOnce(FOUND);
    await enrichCandidateFromGem(CAND, { userId: OWNER });
    expect(lookup).toHaveBeenCalledWith(OWNER, 'jane@example.com', { extId: 'g-1' });
  });

  it('schedules in waitUntil, swallows errors, and dedupes per candidate', async () => {
    mockPrisma.user.findFirst.mockResolvedValue({ id: OWNER });
    lookup.mockRejectedValueOnce(new Error('boom'));
    scheduleGemEnrichment(CAND, 'created');
    scheduleGemEnrichment(CAND, 'created');
    expect(waitUntil).toHaveBeenCalledTimes(1);
    await expect(flush()).resolves.toBeUndefined();
  });

  it('runs at most 2 lookups at once', async () => {
    mockPrisma.user.findFirst.mockResolvedValue({ id: OWNER });
    let active = 0;
    let max = 0;
    lookup.mockImplementation(async () => {
      active += 1;
      max = Math.max(max, active);
      await new Promise((r) => setTimeout(r, 20));
      active -= 1;
      return { status: 'NOT_FOUND' };
    });
    for (let i = 0; i < 5; i++) scheduleGemEnrichment(`ckcand00000000000000000${i}x`, 'created');
    await flush();
    expect(lookup).toHaveBeenCalledTimes(5);
    expect(max).toBe(2);
  });

  it('GEM_BACKGROUND_ENRICH=false turns the background lookup off', () => {
    process.env.GEM_BACKGROUND_ENRICH = 'false';
    scheduleGemEnrichment(CAND, 'created');
    expect(waitUntil).not.toHaveBeenCalled();
  });
});
