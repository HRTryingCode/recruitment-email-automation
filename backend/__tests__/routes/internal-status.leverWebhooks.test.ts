// H2: sync-health reports Lever webhook deliveries (LEVER_WEBHOOK_RECEIVED)
// in `meta`, alongside the per-mailbox `data` array (shape unchanged).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';

import { buildPrismaMock, resetPrismaMock, type MockPrisma } from '../_setup/mockPrisma';
import { loadApp, bearer } from '../_setup/testApp';

vi.mock('../../src/db/client', () => {
  const prisma = buildPrismaMock();
  return { prisma, default: prisma };
});

import { prisma as injectedPrisma } from '../../src/db/client';
const mockPrisma = injectedPrisma as unknown as MockPrisma;
const AUTH = bearer('test-user-1');

describe('GET /api/internal/sync-health — Lever webhook meta (H2)', () => {
  let app: Awaited<ReturnType<typeof loadApp>>;

  beforeEach(async () => {
    resetPrismaMock(mockPrisma);
    app = await loadApp();
    mockPrisma.mailbox.findMany.mockResolvedValue([]);
    mockPrisma.$queryRaw.mockResolvedValue([]);
    mockPrisma.systemLog.findMany.mockResolvedValue([]);
  });

  it('returns the 24h count and the latest delivery time', async () => {
    const last = new Date('2026-10-22T11:58:00Z');
    mockPrisma.systemLog.count.mockResolvedValue(42);
    mockPrisma.systemLog.findFirst.mockResolvedValue({ createdAt: last });
    const res = await request(app).get('/api/internal/sync-health').set('Authorization', AUTH);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.meta).toEqual({ leverWebhooksLast24h: 42, lastLeverWebhookAt: last.toISOString() });
    expect(mockPrisma.systemLog.count.mock.calls[0]![0].where.event).toBe('LEVER_WEBHOOK_RECEIVED');
  });

  it('reports nulls (not zeros) when the query fails', async () => {
    mockPrisma.systemLog.count.mockRejectedValue(new Error('pool timeout'));
    const res = await request(app).get('/api/internal/sync-health').set('Authorization', AUTH);
    expect(res.status).toBe(200);
    expect(res.body.meta).toEqual({ leverWebhooksLast24h: null, lastLeverWebhookAt: null });
  });

  it('lastLeverWebhookAt is null when none has ever arrived', async () => {
    mockPrisma.systemLog.count.mockResolvedValue(0);
    mockPrisma.systemLog.findFirst.mockResolvedValue(null);
    const res = await request(app).get('/api/internal/sync-health').set('Authorization', AUTH);
    expect(res.body.meta).toEqual({ leverWebhooksLast24h: 0, lastLeverWebhookAt: null });
  });
});
