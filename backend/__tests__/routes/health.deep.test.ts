import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';

import { buildPrismaMock, resetPrismaMock, type MockPrisma } from '../_setup/mockPrisma';
import { loadApp } from '../_setup/testApp';

vi.mock('../../src/db/client', () => {
  const prisma = buildPrismaMock();
  return { prisma, default: prisma };
});

import { prisma as injectedPrisma } from '../../src/db/client';
import { _resetDeepHealthCacheForTests } from '../../src/routes/health';
const mockPrisma = injectedPrisma as unknown as MockPrisma;

const NOW = new Date('2026-10-22T12:00:00Z');
const minsAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

const healthy = {
  id: 'mb-ok',
  emailAddress: 'ok@archive.com',
  authStatus: 'OK',
  lastAuthError: null,
  watchExpiry: new Date(NOW.getTime() + 5 * 24 * 3600_000),
  createdAt: new Date('2026-01-01T00:00:00Z'),
};

function recon(mailboxId: string, m: number) {
  return { event: 'RECONCILIATION_RUN', details: JSON.stringify({ mailboxId }), createdAt: minsAgo(m) };
}

describe('GET /api/health/deep (public, for external uptime monitors)', () => {
  let app: Awaited<ReturnType<typeof loadApp>>;

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    resetPrismaMock(mockPrisma);
    _resetDeepHealthCacheForTests();
    mockPrisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
    app = await loadApp();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns 200 healthy when mailboxes and reconcile are fine', async () => {
    mockPrisma.mailbox.findMany.mockResolvedValue([healthy]);
    mockPrisma.systemLog.findMany.mockResolvedValue([recon('mb-ok', 20)]);

    const res = await request(app).get('/api/health/deep');

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('healthy');
    expect(res.body.data.issues).toEqual({});
  });

  it('returns 503 degraded with issue counts (no PII) when a mailbox needs reauth or is stale', async () => {
    const revoked = { ...healthy, id: 'mb-s', emailAddress: 'sofia@archive.com', authStatus: 'NEEDS_REAUTH', lastAuthError: 'invalid_grant' };
    const stale = { ...healthy, id: 'mb-st', emailAddress: 'stale@archive.com' };
    mockPrisma.mailbox.findMany.mockResolvedValue([healthy, revoked, stale]);
    mockPrisma.systemLog.findMany.mockResolvedValue([recon('mb-ok', 20), recon('mb-st', 300)]);

    const res = await request(app).get('/api/health/deep');

    expect(res.status).toBe(503);
    expect(res.body.data.status).toBe('degraded');
    expect(res.body.data.issues).toEqual({ needs_reauth: 1, reconcile_stale: 1 });
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('@archive.com');
    expect(body).not.toContain('mb-s');
  });

  it('returns 503 unhealthy when the database is down', async () => {
    mockPrisma.$queryRaw.mockRejectedValue(new Error('db down'));
    mockPrisma.mailbox.findMany.mockRejectedValue(new Error('db down'));
    mockPrisma.systemLog.findMany.mockRejectedValue(new Error('db down'));

    const res = await request(app).get('/api/health/deep');

    expect(res.status).toBe(503);
    expect(res.body.data.status).toBe('unhealthy');
  });
});
