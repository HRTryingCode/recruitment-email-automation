// H2: a verified Lever webhook → dedupe → find our candidates for the
// opportunity → re-read each from Lever (never trusting payload fields).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { buildPrismaMock, resetPrismaMock, type MockPrisma } from '../_setup/mockPrisma';

vi.mock('../../src/db/client', () => {
  const prisma = buildPrismaMock();
  return { prisma, default: prisma };
});

const { refreshCandidateLever } = vi.hoisted(() => ({ refreshCandidateLever: vi.fn() }));
vi.mock('../../src/services/leverSync.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/leverSync.service')>()),
  refreshCandidateLever,
}));

import { prisma as injected } from '../../src/db/client';
import { processLeverWebhook, type LeverWebhookEvent } from '../../src/services/leverRealtime.service';

const mockPrisma = injected as unknown as MockPrisma;
const TRIGGERED = 1_790_000_000_000;

function evt(event: string, over: Partial<LeverWebhookEvent> = {}): LeverWebhookEvent {
  return { event, opportunityId: 'opp-1', triggeredAt: TRIGGERED, dedupeKey: `${event}:opp-1:${TRIGGERED}`, ...over };
}
function fakeClient(emails: string[] | null) {
  return { configured: true, findByEmail: vi.fn(), getOpportunityEmails: vi.fn().mockResolvedValue(emails) };
}
const refreshedIds = () => refreshCandidateLever.mock.calls.map((c) => c[0]);
const loggedEvents = () => mockPrisma.systemLog.create.mock.calls.map((c) => c[0].data.event);

beforeEach(() => {
  resetPrismaMock(mockPrisma);
  refreshCandidateLever.mockReset().mockResolvedValue({ candidate: {}, status: {} });
  mockPrisma.leverWebhookEvent.create.mockResolvedValue({});
  mockPrisma.systemLog.create.mockResolvedValue({});
  mockPrisma.candidate.findMany.mockResolvedValue([]);
});

describe('processLeverWebhook', () => {
  for (const event of ['applicationCreated', 'candidateStageChange', 'candidateArchiveChange', 'candidateHired', 'candidateDeleted']) {
    it(`${event}: refreshes the candidate linked to the opportunity`, async () => {
      mockPrisma.candidate.findMany.mockResolvedValueOnce([{ id: 'cand-1' }]).mockResolvedValueOnce([]);
      const client = fakeClient(['ada@example.com']);
      const out = await processLeverWebhook(evt(event), client);
      expect(out).toEqual({ duplicate: false, candidateIds: ['cand-1'] });
      expect(refreshCandidateLever).toHaveBeenCalledWith('cand-1', client);
      expect(mockPrisma.candidate.findMany.mock.calls[0]![0].where).toEqual({ leverOpportunityId: 'opp-1' });
    });
  }

  it('records the delivery for dedupe and logs LEVER_WEBHOOK_RECEIVED (no PII)', async () => {
    await processLeverWebhook(evt('candidateHired'), fakeClient(null));
    expect(mockPrisma.leverWebhookEvent.create).toHaveBeenCalledWith({
      data: {
        id: `candidateHired:opp-1:${TRIGGERED}`,
        event: 'candidateHired',
        opportunityId: 'opp-1',
        triggeredAt: new Date(TRIGGERED),
      },
    });
    const log = mockPrisma.systemLog.create.mock.calls.find((c) => c[0].data.event === 'LEVER_WEBHOOK_RECEIVED')![0].data;
    expect(JSON.parse(log.details)).toEqual({ event: 'candidateHired', opportunityId: 'opp-1' });
  });

  it('matches by the opportunity emails when no candidate stores the opportunity id (new application)', async () => {
    mockPrisma.candidate.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'cand-2' }]);
    const out = await processLeverWebhook(evt('applicationCreated'), fakeClient(['ada@example.com', 'ada@work.io']));
    expect(out.candidateIds).toEqual(['cand-2']);
    expect(mockPrisma.candidate.findMany.mock.calls[1]![0].where).toEqual({
      OR: [
        { email: { equals: 'ada@example.com', mode: 'insensitive' } },
        { email: { equals: 'ada@work.io', mode: 'insensitive' } },
      ],
    });
  });

  it('refreshes each matching candidate once when both lookups find it', async () => {
    mockPrisma.candidate.findMany.mockResolvedValueOnce([{ id: 'cand-1' }]).mockResolvedValueOnce([{ id: 'cand-1' }, { id: 'cand-3' }]);
    const out = await processLeverWebhook(evt('candidateStageChange'), fakeClient(['a@x.io']));
    expect(out.candidateIds).toEqual(['cand-1', 'cand-3']);
    expect(refreshedIds()).toEqual(['cand-1', 'cand-3']);
  });

  it('candidateDeleted: opportunity is gone in Lever (404 → null) but the stored link still finds the candidate', async () => {
    mockPrisma.candidate.findMany.mockResolvedValueOnce([{ id: 'cand-1' }]);
    const out = await processLeverWebhook(evt('candidateDeleted'), fakeClient(null));
    expect(out.candidateIds).toEqual(['cand-1']);
    expect(mockPrisma.candidate.findMany).toHaveBeenCalledTimes(1);
  });

  it('a redelivery (dedupe key already stored) does nothing', async () => {
    mockPrisma.leverWebhookEvent.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'x' })
    );
    const client = fakeClient(['a@x.io']);
    await expect(processLeverWebhook(evt('candidateHired'), client)).resolves.toEqual({ duplicate: true, candidateIds: [] });
    expect(client.getOpportunityEmails).not.toHaveBeenCalled();
    expect(refreshCandidateLever).not.toHaveBeenCalled();
    expect(loggedEvents()).toEqual([]);
  });

  it('a dedupe write failing for another reason still processes (refresh is idempotent)', async () => {
    mockPrisma.leverWebhookEvent.create.mockRejectedValueOnce(new Error('connection reset'));
    mockPrisma.candidate.findMany.mockResolvedValueOnce([{ id: 'cand-1' }]);
    const out = await processLeverWebhook(evt('candidateHired'), fakeClient(null));
    expect(out).toEqual({ duplicate: false, candidateIds: ['cand-1'] });
  });

  it('no matching candidate → nothing refreshed', async () => {
    const out = await processLeverWebhook(evt('applicationCreated'), fakeClient(['stranger@x.io']));
    expect(out.candidateIds).toEqual([]);
    expect(refreshCandidateLever).not.toHaveBeenCalled();
  });

  it('caps the refreshes per delivery', async () => {
    mockPrisma.candidate.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(Array.from({ length: 15 }, (_, i) => ({ id: `c${i}` })));
    const out = await processLeverWebhook(evt('candidateHired'), fakeClient(['a@x.io']));
    expect(out.candidateIds).toHaveLength(10);
    expect(mockPrisma.candidate.findMany.mock.calls[1]![0].take).toBe(10);
  });
});
