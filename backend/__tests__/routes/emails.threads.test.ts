// Audit B6 / H8: the threads API only exposes candidate-linked threads unless
// an admin explicitly asks for unlinked ones.
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
const asRecruiter = () =>
  mockPrisma.user.findUnique.mockResolvedValue({ id: 'test-user-1', role: 'recruiter' });

describe('GET /api/emails/threads (H8)', () => {
  let app: Awaited<ReturnType<typeof loadApp>>;
  beforeEach(async () => {
    resetPrismaMock(mockPrisma);
    mockPrisma.emailThread.findMany.mockResolvedValue([]);
    mockPrisma.emailThread.count.mockResolvedValue(0);
    app = await loadApp();
  });

  it('defaults to candidate-linked threads only', async () => {
    asRecruiter();
    const res = await request(app).get('/api/emails/threads').set('Authorization', AUTH);
    expect(res.status).toBe(200);
    const where = mockPrisma.emailThread.findMany.mock.calls[0]![0].where;
    expect(where.candidateId).toEqual({ not: null });
    expect(mockPrisma.emailThread.count.mock.calls[0]![0].where.candidateId).toEqual({ not: null });
  });

  it('keeps an explicit candidateId filter', async () => {
    asRecruiter();
    const cid = 'ckabcdefghijklmnopqrstuv';
    await request(app).get(`/api/emails/threads?candidateId=${cid}`).set('Authorization', AUTH);
    expect(mockPrisma.emailThread.findMany.mock.calls[0]![0].where.candidateId).toBe(cid);
  });

  it('rejects includeUnlinked for a recruiter with 403', async () => {
    asRecruiter();
    const res = await request(app)
      .get('/api/emails/threads?includeUnlinked=true')
      .set('Authorization', AUTH);
    expect(res.status).toBe(403);
    expect(mockPrisma.emailThread.findMany).not.toHaveBeenCalled();
  });

  it('lets an admin include unlinked threads', async () => {
    const res = await request(app)
      .get('/api/emails/threads?includeUnlinked=true')
      .set('Authorization', AUTH);
    expect(res.status).toBe(200);
    expect(mockPrisma.emailThread.findMany.mock.calls[0]![0].where.candidateId).toBeUndefined();
  });
});

describe('GET /api/emails/threads/:id/messages (H8)', () => {
  let app: Awaited<ReturnType<typeof loadApp>>;
  beforeEach(async () => {
    resetPrismaMock(mockPrisma);
    app = await loadApp();
  });

  const thread = (candidateId: string | null) => ({
    id: 't1',
    candidateId,
    messages: [],
    drafts: [],
    candidate: null,
    mailbox: { id: 'mb-1', emailAddress: 'r@archive.com', provider: 'GMAIL' },
  });

  it('returns 404 to a recruiter for a thread with no candidate', async () => {
    asRecruiter();
    mockPrisma.emailThread.findUnique.mockResolvedValueOnce(thread(null));
    const res = await request(app).get('/api/emails/threads/t1/messages').set('Authorization', AUTH);
    expect(res.status).toBe(404);
    expect(res.body.data).toBeUndefined();
  });

  it('serves a candidate-linked thread to a recruiter', async () => {
    asRecruiter();
    mockPrisma.emailThread.findUnique.mockResolvedValueOnce(thread('cand-1'));
    const res = await request(app).get('/api/emails/threads/t1/messages').set('Authorization', AUTH);
    expect(res.status).toBe(200);
  });

  it('serves an unlinked thread to an admin', async () => {
    mockPrisma.emailThread.findUnique.mockResolvedValueOnce(thread(null));
    const res = await request(app).get('/api/emails/threads/t1/messages').set('Authorization', AUTH);
    expect(res.status).toBe(200);
  });
});
