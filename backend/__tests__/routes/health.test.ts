import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';

import { buildPrismaMock } from '../_setup/mockPrisma';
import { loadApp } from '../_setup/testApp';
import type { HealthStatus } from '../../src/services/monitoring.service';

// /api/health is unauthenticated, so it must only ever expose the minimal
// liveness payload. This is the regression guard for the Phase BA PII fix:
// checkHealth() returns mailbox addresses, DB latency and raw log details,
// and none of that may reach the public response.
const { checkHealth } = vi.hoisted(() => ({ checkHealth: vi.fn() }));

vi.mock('../../src/services/monitoring.service', async () => {
  const actual = await vi.importActual<typeof import('../../src/services/monitoring.service')>(
    '../../src/services/monitoring.service'
  );
  return { ...actual, checkHealth };
});

vi.mock('../../src/db/client', () => {
  const prisma = buildPrismaMock();
  return { prisma, default: prisma };
});

function richHealth(status: HealthStatus['status']): HealthStatus {
  return {
    status,
    database: { connected: status !== 'unhealthy', latencyMs: 42 },
    claude: { available: true },
    mailboxes: [
      {
        id: 'mb-1',
        emailAddress: 'recruiter@archive.com',
        provider: 'GMAIL',
        isActive: true,
        watchExpiry: new Date('2026-10-30T00:00:00Z'),
      },
    ],
    recentLogs: [
      {
        id: 'log-1',
        event: 'WEBHOOK_HANDLER_ERROR',
        level: 'ERROR',
        createdAt: new Date('2026-10-22T00:00:00Z'),
        details: { error: 'connect to db.pooler.supabase.com failed for candidate@example.com' },
      },
    ],
  } as HealthStatus;
}

describe('GET /api/health', () => {
  let app: Awaited<ReturnType<typeof loadApp>>;

  beforeEach(async () => {
    checkHealth.mockReset();
    app = await loadApp();
  });

  it('exposes only the allowlisted keys and no email addresses', async () => {
    checkHealth.mockResolvedValueOnce(richHealth('healthy'));

    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['data', 'success']);
    expect(Object.keys(res.body.data).sort()).toEqual(['claude', 'database', 'status']);
    expect(Object.keys(res.body.data.database)).toEqual(['connected']);
    expect(Object.keys(res.body.data.claude)).toEqual(['available']);
    expect(res.body.data).toEqual({
      status: 'healthy',
      database: { connected: true },
      claude: { available: true },
    });
    expect(res.text).not.toContain('@');
    expect(res.text).not.toContain('latencyMs');
    expect(res.text).not.toContain('supabase');
  });

  it('returns 503 with the same minimal payload when unhealthy', async () => {
    checkHealth.mockResolvedValueOnce(richHealth('unhealthy'));

    const res = await request(app).get('/api/health');

    expect(res.status).toBe(503);
    expect(Object.keys(res.body.data).sort()).toEqual(['claude', 'database', 'status']);
    expect(res.body.data.status).toBe('unhealthy');
    expect(res.text).not.toContain('@');
  });

  it('does not require a JWT', async () => {
    checkHealth.mockResolvedValueOnce(richHealth('degraded'));

    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('degraded');
  });
});
