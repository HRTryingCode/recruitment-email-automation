// GET /api/inbox wiring: validation, one grouped counts query, hydration,
// presence and cursor. The view rules themselves are tested against real
// Postgres in services/inbox.sql.test.ts.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';

import { buildPrismaMock, resetPrismaMock, type MockPrisma } from '../_setup/mockPrisma';
import { loadApp, bearer } from '../_setup/testApp';
import { encodeCursor } from '../../src/services/inbox.service';

vi.mock('../../src/db/client', () => {
  const prisma = buildPrismaMock();
  return { prisma, default: prisma };
});

import { prisma as injectedPrisma } from '../../src/db/client';
const mockPrisma = injectedPrisma as unknown as MockPrisma;
const ME = 'test-user-1';
const AUTH = bearer(ME);

const mailbox = { id: 'mb-1', emailAddress: 'aaron@archive.com', displayName: 'Aaron' };
const candidate = {
  id: 'cand-1',
  name: 'Jane',
  email: 'jane@example.com',
  role: 'Engineer',
  status: 'INTERESTED',
  leverState: 'ACTIVE',
  leverStage: 'Interest Call',
  leverPostingTitle: 'Engineer',
  leverOpportunityId: 'opp-1',
};
const draftRow = {
  id: 'draft-1',
  threadId: 'thread-1',
  status: 'PENDING',
  subject: 'Re: hi',
  bodyText: 'x'.repeat(500),
  aiBodyText: 'x'.repeat(500),
  classification: 'INTERESTED',
  confidence: 0.91,
  classificationReason: 'Wants to talk',
  evidenceQuote: 'Sounds great',
  editedAt: null,
  snoozedUntil: null,
  returnedFromSnoozeAt: null,
  scheduledSendAt: null,
  sentAt: null,
  sendError: null,
  ccEmail: null,
  createdAt: new Date('2026-10-22T10:00:00Z'),
  thread: { candidate, mailbox },
};

/** $queryRaw is called with a Prisma.Sql; tell counts from items by its text. */
function programRaw(items: Array<{ id: string; kind: string; sortAt: Date }>) {
  mockPrisma.$queryRaw.mockImplementation(async (sql: { strings: string[] }) =>
    sql.strings.join('?').includes('GROUP BY view')
      ? [
          { view: 'interested', count: 4 },
          { view: 'needs_review', count: 2 },
        ]
      : sql.strings.join('?').includes('GROUP BY role')
        ? [
            { role: 'Engineer', count: 3 },
            { role: null, count: 1 },
          ]
        : items
  );
}

describe('GET /api/inbox', () => {
  let app: Awaited<ReturnType<typeof loadApp>>;
  beforeEach(async () => {
    resetPrismaMock(mockPrisma);
    mockPrisma.emailDraft.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.emailDraft.findMany.mockResolvedValue([draftRow]);
    mockPrisma.candidate.findMany.mockResolvedValue([]);
    app = await loadApp();
  });

  it('401 without auth', async () => {
    const res = await request(app).get('/api/inbox');
    expect(res.status).toBe(401);
  });

  it('returns hydrated items plus counts for every view from one grouped query', async () => {
    programRaw([{ id: 'draft-1', kind: 'draft', sortAt: new Date('2026-10-22T10:00:00Z') }]);
    mockPrisma.draftPresence.findMany.mockResolvedValue([
      { draftId: 'draft-1', userId: 'u-2', mode: 'viewing', heartbeatAt: new Date(), user: { name: 'Sofia', email: 's@a.com' } },
    ]);
    const res = await request(app).get('/api/inbox?view=interested').set('Authorization', AUTH);
    expect(res.status).toBe(200);
    // Exactly three raw queries: grouped view counts, grouped role counts, one page.
    expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(3);
    const texts = mockPrisma.$queryRaw.mock.calls.map(([sql]) => (sql as { strings: string[] }).strings.join('?'));
    expect(texts.filter((t) => t.includes('GROUP BY view'))).toHaveLength(1);
    expect(res.body.data.counts).toEqual({ needs_review: 2, interested: 4, not_interested: 0, snoozed: 0, sent_today: 0 });
    expect(res.body.data.roleCounts).toEqual([
      { role: 'Engineer', count: 3 },
      { role: null, count: 1 },
    ]);
    const [item] = res.body.data.items;
    expect(item).toMatchObject({
      kind: 'draft',
      id: 'draft-1',
      view: 'interested',
      draft: {
        confidenceLabel: 'high',
        classificationReason: 'Wants to talk',
        evidenceQuote: 'Sounds great',
        hasEdits: false,
        ccAddress: expect.anything(),
      },
      candidate: { leverState: 'ACTIVE', leverStage: 'Interest Call' },
      mailbox: { emailAddress: 'aaron@archive.com' },
      presence: [{ userId: 'u-2', name: 'Sofia', mode: 'viewing' }],
    });
    expect(item.draft.preview).toHaveLength(200);
    expect(typeof item.ageMs).toBe('number');
    expect(res.body.data.nextCursor).toBeNull();
  });

  it('names who edited the draft and when a pending draft expires', async () => {
    programRaw([{ id: 'draft-1', kind: 'draft', sortAt: new Date('2026-10-22T10:00:00Z') }]);
    mockPrisma.emailDraft.findMany.mockResolvedValue([
      { ...draftRow, bodyText: 'edited', editedAt: new Date('2026-10-22T11:00:00Z'), editedByUserId: 'u-ana' },
    ]);
    mockPrisma.user.findMany.mockResolvedValue([{ id: 'u-ana', name: 'Ana Recruiter', email: 'ana@archive.com' }]);
    const res = await request(app).get('/api/inbox?view=interested').set('Authorization', AUTH);
    const [item] = res.body.data.items;
    expect(item.draft).toMatchObject({ hasEdits: true, editedByName: 'Ana Recruiter' });
    expect(item.draft.expiresAt).toBe('2026-11-12T10:00:00.000Z');
  });

  it('has no expiry for sent drafts and no editor name without edits', async () => {
    programRaw([{ id: 'draft-1', kind: 'draft', sortAt: new Date('2026-10-22T10:00:00Z') }]);
    mockPrisma.emailDraft.findMany.mockResolvedValue([{ ...draftRow, status: 'SENT', editedByUserId: null }]);
    const res = await request(app).get('/api/inbox?view=sent_today').set('Authorization', AUTH);
    const [item] = res.body.data.items;
    expect(item.draft.expiresAt).toBeNull();
    expect(item.draft.editedByName).toBeNull();
  });

  it('releases expired snoozes before reading, so they count again', async () => {
    programRaw([]);
    await request(app).get('/api/inbox').set('Authorization', AUTH).expect(200);
    expect(mockPrisma.emailDraft.updateMany).toHaveBeenCalledWith({
      where: { snoozedUntil: { lte: expect.any(Date) } },
      data: { snoozedUntil: null, returnedFromSnoozeAt: expect.any(Date) },
    });
    const releaseOrder = mockPrisma.emailDraft.updateMany.mock.invocationCallOrder[0];
    expect(releaseOrder).toBeLessThan(mockPrisma.$queryRaw.mock.invocationCallOrder[0]);
  });

  it('includes NEEDS_REVIEW candidates as kind:candidate items', async () => {
    programRaw([{ id: 'cand-9', kind: 'candidate', sortAt: new Date('2026-10-22T09:00:00Z') }]);
    mockPrisma.candidate.findMany.mockResolvedValue([{ ...candidate, id: 'cand-9', status: 'NEEDS_REVIEW', mailbox }]);
    const res = await request(app).get('/api/inbox?view=needs_review').set('Authorization', AUTH);
    expect(res.body.data.items[0]).toMatchObject({ kind: 'candidate', draft: null, candidate: { id: 'cand-9' }, mailbox: { id: 'mb-1' } });
  });

  it('returns a cursor when there is another page', async () => {
    const rows = Array.from({ length: 51 }, (_, i) => ({
      id: `draft-${i}`,
      kind: 'draft',
      sortAt: new Date(Date.UTC(2026, 9, 22, 10, 0, 60 - i)),
    }));
    programRaw(rows);
    mockPrisma.emailDraft.findMany.mockResolvedValue(rows.map((r) => ({ ...draftRow, id: r.id })));
    const res = await request(app).get('/api/inbox?view=interested').set('Authorization', AUTH);
    expect(res.body.data.items).toHaveLength(50);
    expect(res.body.data.nextCursor).toBe(encodeCursor({ sortAt: rows[49].sortAt, kind: 'draft', id: 'draft-49' }));
  });

  it('passes repeated ?role= (and __none__ for unknown) into the items and counts queries', async () => {
    programRaw([]);
    await request(app)
      .get('/api/inbox?view=needs_review&role=Engineer%2C%20Platform&role=__none__&order=oldest')
      .set('Authorization', AUTH)
      .expect(200);
    const calls = mockPrisma.$queryRaw.mock.calls.map(([sql]) => sql as { strings: string[]; values: unknown[] });
    const items = calls.find((c) => !c.strings.join('?').includes('GROUP BY'))!;
    const counts = calls.find((c) => c.strings.join('?').includes('GROUP BY view'))!;
    const roleCounts = calls.find((c) => c.strings.join('?').includes('GROUP BY role'))!;
    // A comma inside a role title is part of the title, not a separator.
    expect(items.values).toContain('Engineer, Platform');
    expect(items.strings.join('?')).toMatch(/role IS NULL/);
    expect(items.strings.join('?')).toMatch(/ASC/);
    expect(counts.values).toContain('Engineer, Platform');
    // Role counts are for the whole view, so the filter list never hides options.
    expect(roleCounts.values).not.toContain('Engineer, Platform');
  });

  it('no ?role= means no role filter', async () => {
    programRaw([]);
    await request(app).get('/api/inbox?view=needs_review').set('Authorization', AUTH).expect(200);
    const items = mockPrisma.$queryRaw.mock.calls
      .map(([sql]) => sql as { strings: string[] })
      .find((c) => !c.strings.join('?').includes('GROUP BY'))!;
    expect(items.strings.join('?')).not.toMatch(/role IS NULL/);
  });

  it.each([
    [`role=${'x'.repeat(201)}`, /role/],
    ['view=everything', /view/],
    ['mailboxId=not-a-cuid', /mailboxId/],
    ['cursor=@@@', /cursor/],
    ['order=sideways', /order/],
  ])('400 for %s', async (qs, msg) => {
    const res = await request(app).get(`/api/inbox?${qs}`).set('Authorization', AUTH);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(msg);
  });
});
