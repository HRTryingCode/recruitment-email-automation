// H2: changing a candidate's email re-checks Lever in the background, since
// the Lever match is by email.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';

import { buildPrismaMock, resetPrismaMock, type MockPrisma } from '../_setup/mockPrisma';
import { loadApp, bearer } from '../_setup/testApp';

vi.mock('../../src/db/client', () => {
  const prisma = buildPrismaMock();
  return { prisma, default: prisma };
});

const { scheduleLeverRefresh } = vi.hoisted(() => ({ scheduleLeverRefresh: vi.fn() }));
vi.mock('../../src/services/leverRealtime.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/leverRealtime.service')>()),
  scheduleLeverRefresh,
}));

import { prisma as injectedPrisma } from '../../src/db/client';
const mockPrisma = injectedPrisma as unknown as MockPrisma;

const AUTH = bearer('test-user-1');
const ID = 'cand-1';

describe('PATCH /api/candidates/:id — Lever refresh on email change (H2)', () => {
  let app: Awaited<ReturnType<typeof loadApp>>;

  beforeEach(async () => {
    resetPrismaMock(mockPrisma);
    scheduleLeverRefresh.mockReset();
    app = await loadApp();
    mockPrisma.candidate.findUnique.mockResolvedValue({ id: ID, email: 'old@example.com', status: 'NEUTRAL', threads: [] });
    mockPrisma.candidate.findFirst.mockResolvedValue(null);
    mockPrisma.candidate.update.mockImplementation(async (a: { data: object }) => ({ id: ID, ...a.data }));
  });

  it('schedules a refresh after the email is changed', async () => {
    const res = await request(app).patch(`/api/candidates/${ID}`).set('Authorization', AUTH).send({ email: 'New@Example.com' });
    expect(res.status).toBe(200);
    expect(scheduleLeverRefresh).toHaveBeenCalledWith(ID, 'email_changed');
  });

  it('also schedules it when the same PATCH ignores the candidate', async () => {
    mockPrisma.$transaction.mockResolvedValue([{ id: ID, email: 'new@example.com', status: 'IGNORED' }, { count: 0 }]);
    mockPrisma.systemLog.create.mockResolvedValue({});
    const res = await request(app)
      .patch(`/api/candidates/${ID}`)
      .set('Authorization', AUTH)
      .send({ email: 'new@example.com', status: 'IGNORED' });
    expect(res.status).toBe(200);
    expect(scheduleLeverRefresh).toHaveBeenCalledWith(ID, 'email_changed');
  });

  it('does not schedule for a case-only change or a non-email edit', async () => {
    await request(app).patch(`/api/candidates/${ID}`).set('Authorization', AUTH).send({ email: 'OLD@example.com' });
    await request(app).patch(`/api/candidates/${ID}`).set('Authorization', AUTH).send({ status: 'INTERESTED' });
    expect(scheduleLeverRefresh).not.toHaveBeenCalled();
  });

  it('does not schedule when the new email collides (409)', async () => {
    mockPrisma.candidate.findFirst.mockResolvedValue({ id: 'other' });
    const res = await request(app).patch(`/api/candidates/${ID}`).set('Authorization', AUTH).send({ email: 'taken@example.com' });
    expect(res.status).toBe(409);
    expect(scheduleLeverRefresh).not.toHaveBeenCalled();
  });
});
