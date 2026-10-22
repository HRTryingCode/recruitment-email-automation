import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';

import { buildPrismaMock, resetPrismaMock, type MockPrisma } from '../_setup/mockPrisma';
import { loadApp, bearer } from '../_setup/testApp';

vi.mock('../../src/db/client', () => {
  const prisma = buildPrismaMock();
  // Prisma field references (prisma.candidate.fields.*) used by the
  // reply-status filter.
  (prisma.candidate as unknown as { fields: unknown }).fields = {
    lastOutboundAt: { name: 'lastOutboundAt', modelName: 'Candidate' },
  };
  return { prisma, default: prisma };
});

import { prisma as injectedPrisma } from '../../src/db/client';
const mockPrisma = injectedPrisma as unknown as MockPrisma;
const AUTH = bearer('test-user-1');

describe('/api/candidates — candidate state (H6, M18, M19, M20, L16, M12)', () => {
  let app: Awaited<ReturnType<typeof loadApp>>;

  beforeEach(async () => {
    resetPrismaMock(mockPrisma);
    app = await loadApp();
  });

  describe('GET /api/candidates/counts (M18)', () => {
    it('returns server-side totals and per-mailbox counts', async () => {
      mockPrisma.$queryRaw
        .mockResolvedValueOnce([
          { mailboxId: 'mb-1', candidates: 400, needsReview: 50, awaitingReply: 200 },
          { mailboxId: 'mb-2', candidates: 192, needsReview: 25, awaitingReply: 124 },
        ])
        .mockResolvedValueOnce([
          { mailboxId: 'mb-1', pendingDrafts: 7 },
          { mailboxId: 'mb-2', pendingDrafts: 3 },
        ]);

      const res = await request(app).get('/api/candidates/counts').set('Authorization', AUTH);

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({
        candidates: 592,
        awaitingReply: 324,
        needsReview: 75,
        pendingDrafts: 10,
        byMailbox: [
          { mailboxId: 'mb-1', candidates: 400, needsReview: 50, awaitingReply: 200, pendingDrafts: 7 },
          { mailboxId: 'mb-2', candidates: 192, needsReview: 25, awaitingReply: 124, pendingDrafts: 3 },
        ],
      });
      // Not swallowed by GET /:id.
      expect(mockPrisma.candidate.findUnique).not.toHaveBeenCalled();
    });

    it('counts awaiting as lastInboundAt > lastOutboundAt in SQL', async () => {
      mockPrisma.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      await request(app).get('/api/candidates/counts').set('Authorization', AUTH).expect(200);
      // Tagged template: first arg is the TemplateStringsArray.
      const sql = (mockPrisma.$queryRaw.mock.calls[0]![0] as string[]).join('?');
      expect(sql).toContain('"lastInboundAt" > c."lastOutboundAt"');
      // Role-less candidates (spam/noise) never count as awaiting.
      expect(sql).toContain('c.role IS NOT NULL');
    });

    it('rejects a malformed mailboxId', async () => {
      const res = await request(app).get('/api/candidates/counts?mailboxId=DROP').set('Authorization', AUTH);
      expect(res.status).toBe(400);
      expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/candidates (H6, M19, L16)', () => {
    it('derives replyStatus from lastInboundAt vs lastOutboundAt', async () => {
      const base = { email: 'a@example.com', name: 'A', status: 'INTERESTED', mailbox: null, threads: [{ id: 't', subject: 's', lastMessageAt: new Date() }], updatedAt: new Date() };
      mockPrisma.candidate.findMany.mockResolvedValueOnce([
        // repliedAt is set (old model: "Replied") but the candidate wrote last.
        { ...base, id: 'c1', repliedAt: new Date('2026-10-01'), lastOutboundAt: new Date('2026-10-01'), lastInboundAt: new Date('2026-10-05') },
        { ...base, id: 'c2', repliedAt: new Date('2026-10-06'), lastOutboundAt: new Date('2026-10-06'), lastInboundAt: new Date('2026-10-05') },
      ]);
      mockPrisma.candidate.count.mockResolvedValueOnce(2);

      const res = await request(app).get('/api/candidates').set('Authorization', AUTH);
      const byId = Object.fromEntries(res.body.data.map((c: { id: string; replyStatus: string }) => [c.id, c.replyStatus]));
      expect(byId).toEqual({ c1: 'AWAITING_REPLY', c2: 'REPLIED' });
    });

    it('filters by replyStatus=AWAITING_REPLY server-side', async () => {
      mockPrisma.candidate.findMany.mockResolvedValueOnce([]);
      mockPrisma.candidate.count.mockResolvedValueOnce(0);
      await request(app).get('/api/candidates?replyStatus=AWAITING_REPLY').set('Authorization', AUTH).expect(200);
      const where = mockPrisma.candidate.findMany.mock.calls[0]![0].where;
      expect(where.status).toEqual({ not: 'IGNORED' });
      expect(where.role).toEqual({ not: null });
      expect(JSON.stringify(where.AND)).toContain('lastOutboundAt');
      // count uses the same filter so pagination is honest.
      expect(mockPrisma.candidate.count.mock.calls[0]![0].where).toEqual(where);
    });

    it('rejects an unknown replyStatus', async () => {
      const res = await request(app).get('/api/candidates?replyStatus=MAYBE').set('Authorization', AUTH);
      expect(res.status).toBe(400);
    });

    it('sorts server-side when sort= is given (L16)', async () => {
      mockPrisma.candidate.findMany.mockResolvedValueOnce([]);
      mockPrisma.candidate.count.mockResolvedValueOnce(0);
      await request(app).get('/api/candidates?sort=name&dir=asc&limit=100').set('Authorization', AUTH).expect(200);
      const args = mockPrisma.candidate.findMany.mock.calls[0]![0];
      expect(args.orderBy).toEqual([{ name: 'asc' }, { id: 'asc' }]);
      expect(args.take).toBe(100);
    });

    it('rejects an unknown sort column', async () => {
      const res = await request(app).get('/api/candidates?sort=passwordHash').set('Authorization', AUTH);
      expect(res.status).toBe(400);
    });
  });

  describe('PATCH /api/candidates/:id (M20, M12)', () => {
    it('setting status IGNORED discards live drafts like the ignore endpoint', async () => {
      mockPrisma.candidate.findUnique.mockResolvedValueOnce({
        id: 'cand-1',
        email: 'a@example.com',
        status: 'INTERESTED',
        threads: [{ id: 't-1' }],
      });
      mockPrisma.$transaction.mockResolvedValueOnce([{ id: 'cand-1', status: 'IGNORED' }, { count: 1 }]);

      const res = await request(app).patch('/api/candidates/cand-1').set('Authorization', AUTH).send({ status: 'IGNORED' });

      expect(res.status).toBe(200);
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(mockPrisma.emailDraft.updateMany).toHaveBeenCalledWith({
        where: { threadId: { in: ['t-1'] }, status: { in: ['PENDING', 'APPROVED'] } },
        data: { status: 'DISCARDED' },
      });
    });

    it('clearing repliedAt also clears lastOutboundAt so the candidate shows Awaiting', async () => {
      mockPrisma.candidate.findUnique.mockResolvedValueOnce({ id: 'cand-1', email: 'a@example.com', status: 'NEUTRAL', threads: [] });
      mockPrisma.candidate.update.mockResolvedValueOnce({ id: 'cand-1' });

      await request(app).patch('/api/candidates/cand-1').set('Authorization', AUTH).send({ repliedAt: null }).expect(200);

      expect(mockPrisma.candidate.update).toHaveBeenCalledWith({
        where: { id: 'cand-1' },
        data: { repliedAt: null, lastOutboundAt: null },
      });
    });

    it('lowercases a new email and checks collisions case-insensitively', async () => {
      mockPrisma.candidate.findUnique.mockResolvedValueOnce({ id: 'cand-1', email: 'a@example.com', status: 'NEUTRAL', threads: [] });
      mockPrisma.candidate.findFirst.mockResolvedValueOnce({ id: 'cand-2', email: 'b@example.com' });

      const res = await request(app).patch('/api/candidates/cand-1').set('Authorization', AUTH).send({ email: 'B@Example.com' });

      expect(res.status).toBe(409);
      expect(mockPrisma.candidate.findFirst).toHaveBeenCalledWith({
        where: { email: { equals: 'b@example.com', mode: 'insensitive' } },
      });
    });
  });
});
