import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';

import { buildPrismaMock, resetPrismaMock, type MockPrisma } from '../_setup/mockPrisma';
import { loadApp, bearer } from '../_setup/testApp';

// Audit H2: /api/coverage (report + admin-maintained expected senders) and
// the weekly coverage-summary cron.

const { computeCoverage, sendWeeklyCoverageSummary, refreshSendAsAddresses } = vi.hoisted(() => ({
  computeCoverage: vi.fn(),
  sendWeeklyCoverageSummary: vi.fn(),
  refreshSendAsAddresses: vi.fn(),
}));

vi.mock('../../src/services/coverage.service', async () => {
  const actual = await vi.importActual<typeof import('../../src/services/coverage.service')>(
    '../../src/services/coverage.service'
  );
  return { ...actual, computeCoverage, sendWeeklyCoverageSummary };
});

vi.mock('../../src/services/gmail.service', async () => {
  const actual = await vi.importActual<typeof import('../../src/services/gmail.service')>(
    '../../src/services/gmail.service'
  );
  return { ...actual, refreshSendAsAddresses };
});

vi.mock('../../src/db/client', () => {
  const prisma = buildPrismaMock();
  return { prisma, default: prisma };
});

import { prisma as injectedPrisma } from '../../src/db/client';
const mockPrisma = injectedPrisma as unknown as MockPrisma;

const CRON_SECRET = 'test-cron-secret-value';

let app: Awaited<ReturnType<typeof loadApp>>;
const originalCronSecret = process.env.CRON_SECRET;

beforeEach(async () => {
  process.env.CRON_SECRET = CRON_SECRET;
  resetPrismaMock(mockPrisma);
  computeCoverage.mockReset();
  sendWeeklyCoverageSummary.mockReset();
  refreshSendAsAddresses.mockReset();
  app = await loadApp();
});

afterEach(() => {
  if (originalCronSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = originalCronSecret;
});

describe('GET /api/coverage', () => {
  it('requires auth', async () => {
    const res = await request(app).get('/api/coverage');
    expect(res.status).toBe(401);
  });

  it('returns the coverage report to any signed-in user', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', role: 'recruiter' });
    computeCoverage.mockResolvedValue({
      unmonitored: [{ emailAddress: 'ethan@archive.com', sources: ['ADMIN'], expectedSends30d: 478, displayName: null }],
      quietMailboxes: [],
      mailboxes: [],
      expectedSenderCount: 1,
      windowDays: 30,
      generatedAt: new Date('2026-10-22T00:00:00Z'),
    });
    const res = await request(app).get('/api/coverage').set('Authorization', bearer('u1'));
    expect(res.status).toBe(200);
    expect(res.body.data.unmonitored[0].emailAddress).toBe('ethan@archive.com');
  });
});

describe('expected senders admin list', () => {
  it('lists expected senders for admins', async () => {
    mockPrisma.expectedSender.findMany.mockResolvedValue([{ id: 'es1', emailAddress: 'ethan@archive.com' }]);
    const res = await request(app)
      .get('/api/coverage/expected-senders')
      .set('Authorization', bearer('admin-1'));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it('rejects writes from non-admins', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', role: 'recruiter' });
    const res = await request(app)
      .post('/api/coverage/expected-senders')
      .set('Authorization', bearer('u1'))
      .send({ emailAddress: 'ethan@archive.com' });
    expect(res.status).toBe(403);
    expect(mockPrisma.expectedSender.upsert).not.toHaveBeenCalled();
  });

  it('upserts a normalized address for admins', async () => {
    mockPrisma.expectedSender.upsert.mockResolvedValue({ id: 'es1', emailAddress: 'ethan@archive.com' });
    const res = await request(app)
      .post('/api/coverage/expected-senders')
      .set('Authorization', bearer('admin-1'))
      .send({ emailAddress: '  Ethan@Archive.com ', displayName: 'Ethan (Gem)', expectedSends30d: 478 });
    expect(res.status).toBe(201);
    const args = mockPrisma.expectedSender.upsert.mock.calls[0][0];
    expect(args.where).toEqual({ emailAddress: 'ethan@archive.com' });
    expect(args.create).toMatchObject({
      emailAddress: 'ethan@archive.com',
      displayName: 'Ethan (Gem)',
      expectedSends30d: 478,
      source: 'ADMIN',
      isActive: true,
    });
  });

  it('rejects an invalid email address', async () => {
    const res = await request(app)
      .post('/api/coverage/expected-senders')
      .set('Authorization', bearer('admin-1'))
      .send({ emailAddress: 'not-an-email' });
    expect(res.status).toBe(400);
  });

  it('rejects a negative expectedSends30d', async () => {
    const res = await request(app)
      .post('/api/coverage/expected-senders')
      .set('Authorization', bearer('admin-1'))
      .send({ emailAddress: 'ethan@archive.com', expectedSends30d: -1 });
    expect(res.status).toBe(400);
  });

  it('patches isActive / notes', async () => {
    mockPrisma.expectedSender.update.mockResolvedValue({ id: 'es1', isActive: false });
    const res = await request(app)
      .patch('/api/coverage/expected-senders/es1')
      .set('Authorization', bearer('admin-1'))
      .send({ isActive: false, notes: 'forwarded to emaenza@' });
    expect(res.status).toBe(200);
    expect(mockPrisma.expectedSender.update).toHaveBeenCalledWith({
      where: { id: 'es1' },
      data: { isActive: false, notes: 'forwarded to emaenza@' },
    });
  });

  it('deletes an expected sender', async () => {
    mockPrisma.expectedSender.delete.mockResolvedValue({ id: 'es1' });
    const res = await request(app)
      .delete('/api/coverage/expected-senders/es1')
      .set('Authorization', bearer('admin-1'));
    expect(res.status).toBe(200);
    expect(mockPrisma.expectedSender.delete).toHaveBeenCalledWith({ where: { id: 'es1' } });
  });
});

describe('GET /api/internal/cron/coverage-summary', () => {
  it('returns 401 without the cron secret', async () => {
    const res = await request(app).get('/api/internal/cron/coverage-summary');
    expect(res.status).toBe(401);
    expect(sendWeeklyCoverageSummary).not.toHaveBeenCalled();
  });

  it('does not accept POST', async () => {
    const res = await request(app)
      .post('/api/internal/cron/coverage-summary')
      .set('Authorization', `Bearer ${CRON_SECRET}`);
    expect(res.status).not.toBe(200);
    expect(sendWeeklyCoverageSummary).not.toHaveBeenCalled();
  });

  it('refreshes sendAs for healthy active mailboxes, then sends the summary', async () => {
    mockPrisma.mailbox.findMany.mockResolvedValue([{ id: 'mb1' }, { id: 'mb2' }]);
    refreshSendAsAddresses.mockResolvedValueOnce(['a@archive.com']).mockResolvedValueOnce(null);
    sendWeeklyCoverageSummary.mockResolvedValue({ sent: true, unmonitored: 2, quietMailboxes: 0 });

    const res = await request(app)
      .get('/api/internal/cron/coverage-summary')
      .set('Authorization', `Bearer ${CRON_SECRET}`);

    expect(res.status).toBe(200);
    expect(mockPrisma.mailbox.findMany.mock.calls[0][0].where).toEqual({
      isActive: true,
      authStatus: { not: 'NEEDS_REAUTH' },
    });
    expect(refreshSendAsAddresses).toHaveBeenCalledTimes(2);
    expect(res.body.data).toEqual({
      sendAsRefreshed: 1,
      sendAsFailed: 1,
      sent: true,
      unmonitored: 2,
      quietMailboxes: 0,
    });
  });
});
