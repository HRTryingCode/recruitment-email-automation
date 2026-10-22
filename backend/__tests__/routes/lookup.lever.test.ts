import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { buildPrismaMock, resetPrismaMock, type MockPrisma } from '../_setup/mockPrisma';
import { loadApp, bearer } from '../_setup/testApp';

const { leverLookupIntegration } = vi.hoisted(() => ({ leverLookupIntegration: vi.fn() }));
vi.mock('../../src/services/leverLookup', () => ({ leverLookupIntegration }));

vi.mock('../../src/db/client', () => {
  const prisma = buildPrismaMock();
  return { prisma, default: prisma };
});

import { prisma as injected } from '../../src/db/client';
const mockPrisma = injected as unknown as MockPrisma;
const AUTH = bearer('test-user-1');

const primary = {
  id: 'opp1',
  postingTitle: 'Founding Engineer',
  stage: 'Interest Call',
  archived: false,
  hired: false,
  archivedReason: null,
  createdAt: null,
  updatedAt: null,
  leverUrl: 'https://hire.lever.co/candidates/opp1',
};

describe('GET /api/lookup — integrations.lever (F2)', () => {
  let app: Awaited<ReturnType<typeof loadApp>>;

  beforeEach(async () => {
    resetPrismaMock(mockPrisma);
    leverLookupIntegration.mockReset();
    mockPrisma.candidate.findFirst.mockResolvedValue(null);
    mockPrisma.emailMessage.findMany.mockResolvedValue([]);
    mockPrisma.mailbox.findMany.mockResolvedValue([]);
    mockPrisma.emailDraft.findMany.mockResolvedValue([]);
    mockPrisma.systemLog.findMany.mockResolvedValue([]);
    app = await loadApp();
  });

  it('returns a live Lever status for an address the app has never seen', async () => {
    const lever = {
      status: 'FOUND',
      state: 'ACTIVE',
      primary,
      opportunities: [primary],
      opportunityCount: 1,
      checkedAt: '2026-10-22T12:00:00.000Z',
    };
    leverLookupIntegration.mockResolvedValueOnce(lever);
    const res = await request(app).get('/api/lookup?email=%20Arron@ArronGould.com').set('Authorization', AUTH);
    expect(res.status).toBe(200);
    expect(res.body.data.verdict).toBe('UNKNOWN');
    expect(leverLookupIntegration).toHaveBeenCalledWith('arron@arrongould.com');
    expect(res.body.data.integrations).toEqual({ lever });
  });

  it('omits lever when the integration is not configured', async () => {
    leverLookupIntegration.mockResolvedValueOnce(undefined);
    const res = await request(app).get('/api/lookup?email=a@b.com').set('Authorization', AUTH);
    expect(res.body.data.integrations).toEqual({});
  });

  it('a Lever ERROR is reported under its key and does not fail the lookup', async () => {
    const lever = { status: 'ERROR', state: 'ERROR', message: 'Lever request failed (timeout)', primary: null, opportunities: [], opportunityCount: 0, checkedAt: 'x' };
    leverLookupIntegration.mockResolvedValueOnce(lever);
    const res = await request(app).get('/api/lookup?email=a@b.com').set('Authorization', AUTH);
    expect(res.status).toBe(200);
    expect(res.body.data.integrations.lever).toEqual(lever);
  });

  it('does not call Lever for a rejected (400) email', async () => {
    await request(app).get('/api/lookup?email=nope').set('Authorization', AUTH);
    expect(leverLookupIntegration).not.toHaveBeenCalled();
  });
});
