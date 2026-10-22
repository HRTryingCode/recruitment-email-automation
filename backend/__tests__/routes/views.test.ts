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
const ME = 'test-user-1';
const AUTH = bearer(ME);

function asRecruiter() {
  mockPrisma.user.findUnique.mockResolvedValue({ id: ME, role: 'recruiter' });
}

const mine = { id: 'v-mine', userId: ME, name: 'My hot leads', scope: 'candidates', filters: { status: 'INTERESTED' } };
const shared = { id: 'v-team', userId: null, name: 'Team: needs Lever', scope: 'candidates', filters: { leverState: 'NOT_FOUND' } };
const theirs = { id: 'v-theirs', userId: 'u-other', name: 'Private', scope: 'candidates', filters: {} };

describe('/api/views (saved views, U0)', () => {
  let app: Awaited<ReturnType<typeof loadApp>>;
  beforeEach(async () => {
    resetPrismaMock(mockPrisma);
    mockPrisma.savedView.create.mockImplementation(async ({ data }) => ({ id: 'v-new', ...data }));
    mockPrisma.savedView.update.mockImplementation(async ({ data }) => ({ ...mine, ...data }));
    mockPrisma.savedView.delete.mockResolvedValue({});
    app = await loadApp();
  });

  it('401 without auth', async () => {
    expect((await request(app).get('/api/views')).status).toBe(401);
  });

  it('lists my views plus team-shared ones, filtered by scope', async () => {
    mockPrisma.savedView.findMany.mockResolvedValue([shared, mine]);
    const res = await request(app).get('/api/views?scope=candidates').set('Authorization', AUTH);
    expect(res.status).toBe(200);
    expect(mockPrisma.savedView.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { scope: 'candidates', OR: [{ userId: ME }, { userId: null }] },
    }));
    expect(res.body.data).toEqual([
      { ...shared, shared: true },
      { ...mine, shared: false },
    ]);
  });

  it('400 for an unknown scope', async () => {
    expect((await request(app).get('/api/views?scope=everything').set('Authorization', AUTH)).status).toBe(400);
  });

  it('creates a private view for the caller', async () => {
    asRecruiter();
    const res = await request(app)
      .post('/api/views')
      .set('Authorization', AUTH)
      .send({ name: 'Mine', scope: 'inbox', filters: { view: 'interested' } });
    expect(res.status).toBe(201);
    expect(mockPrisma.savedView.create).toHaveBeenCalledWith({
      data: { userId: ME, name: 'Mine', scope: 'inbox', filters: { view: 'interested' } },
    });
  });

  it('only admins create team-shared views', async () => {
    asRecruiter();
    const denied = await request(app)
      .post('/api/views')
      .set('Authorization', AUTH)
      .send({ name: 'Team', scope: 'inbox', filters: {}, shared: true });
    expect(denied.status).toBe(403);

    mockPrisma.user.findUnique.mockResolvedValue({ id: ME, role: 'admin' });
    const ok = await request(app)
      .post('/api/views')
      .set('Authorization', AUTH)
      .send({ name: 'Team', scope: 'inbox', filters: {}, shared: true });
    expect(ok.status).toBe(201);
    expect(mockPrisma.savedView.create.mock.calls[0][0].data.userId).toBeNull();
  });

  it('rejects oversized or non-object filters and blank names', async () => {
    for (const body of [
      { name: 'x', scope: 'inbox', filters: { blob: 'y'.repeat(11_000) } },
      { name: 'x', scope: 'inbox', filters: ['a'] },
      { name: '   ', scope: 'inbox', filters: {} },
    ]) {
      expect((await request(app).post('/api/views').set('Authorization', AUTH).send(body)).status).toBe(400);
    }
  });

  it('the owner edits and deletes their own view', async () => {
    asRecruiter();
    mockPrisma.savedView.findUnique.mockResolvedValue(mine);
    const patch = await request(app).patch('/api/views/v-mine').set('Authorization', AUTH).send({ name: 'Renamed' });
    expect(patch.status).toBe(200);
    expect(mockPrisma.savedView.update).toHaveBeenCalledWith({ where: { id: 'v-mine' }, data: { name: 'Renamed' } });
    const del = await request(app).delete('/api/views/v-mine').set('Authorization', AUTH);
    expect(del.status).toBe(200);
  });

  it("someone else's private view is invisible (404), even to admins", async () => {
    mockPrisma.savedView.findUnique.mockResolvedValue(theirs);
    expect((await request(app).patch('/api/views/v-theirs').set('Authorization', AUTH).send({ name: 'x' })).status).toBe(404);
    expect((await request(app).delete('/api/views/v-theirs').set('Authorization', AUTH)).status).toBe(404);
    expect(mockPrisma.savedView.update).not.toHaveBeenCalled();
    expect(mockPrisma.savedView.delete).not.toHaveBeenCalled();
  });

  it('team-shared views: recruiters get 403, admins may edit/delete', async () => {
    mockPrisma.savedView.findUnique.mockResolvedValue(shared);
    asRecruiter();
    expect((await request(app).patch('/api/views/v-team').set('Authorization', AUTH).send({ name: 'x' })).status).toBe(403);
    expect((await request(app).delete('/api/views/v-team').set('Authorization', AUTH)).status).toBe(403);
    mockPrisma.user.findUnique.mockResolvedValue({ id: ME, role: 'admin' });
    expect((await request(app).patch('/api/views/v-team').set('Authorization', AUTH).send({ name: 'x' })).status).toBe(200);
    expect((await request(app).delete('/api/views/v-team').set('Authorization', AUTH)).status).toBe(200);
  });
});
