// U0 inbox actions on a single draft: one-step send with undo, dismiss,
// snooze, presence and the editing lock.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';

import { buildPrismaMock, resetPrismaMock, type MockPrisma } from '../_setup/mockPrisma';
import { loadApp, bearer } from '../_setup/testApp';

const { waitUntil, runDelayedSend, deleteDraft, sendDraft, sendAsList, rewriteDraftWithNotes } = vi.hoisted(() => ({
  rewriteDraftWithNotes: vi.fn(),
  waitUntil: vi.fn(),
  runDelayedSend: vi.fn(),
  deleteDraft: vi.fn(),
  sendDraft: vi.fn(),
  sendAsList: vi.fn(),
}));

vi.mock('@vercel/functions', () => ({ waitUntil }));
vi.mock('../../src/services/draftSend.service', async () => {
  const actual = await vi.importActual<typeof import('../../src/services/draftSend.service')>(
    '../../src/services/draftSend.service'
  );
  return { ...actual, runDelayedSend };
});
vi.mock('../../src/services/gmail.service', async () => {
  const actual = await vi.importActual<typeof import('../../src/services/gmail.service')>(
    '../../src/services/gmail.service'
  );
  return { ...actual, deleteDraft, sendDraft, fetchMailboxSignature: vi.fn().mockResolvedValue(null) };
});
vi.mock('../../src/services/claude.service', async () => {
  const actual = await vi.importActual<typeof import('../../src/services/claude.service')>(
    '../../src/services/claude.service'
  );
  return { ...actual, rewriteDraftWithNotes };
});
vi.mock('../../src/db/client', () => {
  const prisma = buildPrismaMock();
  return { prisma, default: prisma };
});

import { prisma as injectedPrisma } from '../../src/db/client';
const mockPrisma = injectedPrisma as unknown as MockPrisma;

const ME = 'test-user-1';
const AUTH = bearer(ME);

const mailbox = { id: 'mb-1', emailAddress: 'aaron@archive.com', displayName: 'Aaron', provider: 'GMAIL' };
const candidate = { id: 'cand-1', name: 'Jane Doe', email: 'jane@example.com' };
const thread = { id: 'thread-1', externalThreadId: 'ext-1', subject: 'Re: hi', mailboxId: 'mb-1', mailbox, candidate, messages: [] };

function logged(event: string): Record<string, unknown> | undefined {
  const call = mockPrisma.systemLog.create.mock.calls.find(([a]) => a.data.event === event);
  return call ? JSON.parse(call[0].data.details) : undefined;
}

/** One-row store: findUnique/update/updateMany behave like the DB for this draft. */
function installDraft(initial: Record<string, unknown>) {
  let row: Record<string, unknown> = {
    id: 'draft-1',
    threadId: 'thread-1',
    subject: 'Re: hi',
    bodyText: 'AI text',
    bodyHtml: '<div>AI text</div>',
    aiBodyText: 'AI text',
    classification: 'INTERESTED',
    confidence: 0.9,
    externalDraftId: null,
    ccEmail: null,
    inReplyToMessageId: null,
    referencesHeader: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...initial,
  };
  const matches = (where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => {
      const cur = row[k] ?? null;
      if (v && typeof v === 'object' && !(v instanceof Date)) {
        const op = v as { in?: unknown[]; not?: unknown };
        if (op.in) return op.in.includes(cur);
        if ('not' in op) return cur !== op.not;
      }
      return cur === v;
    });
  mockPrisma.emailDraft.findUnique.mockImplementation(async () => (row.id ? { ...row, thread } : null));
  mockPrisma.emailDraft.update.mockImplementation(async ({ data }) => {
    row = { ...row, ...data };
    return { ...row };
  });
  mockPrisma.emailDraft.updateMany.mockImplementation(async ({ where, data }) => {
    if (!matches(where)) return { count: 0 };
    row = { ...row, ...data };
    return { count: 1 };
  });
  return { get: () => row };
}

/** Someone else ('u-sofia') editing this draft right now. */
function otherUserEditing() {
  mockPrisma.draftPresence.findMany.mockResolvedValue([
    { draftId: 'draft-1', userId: 'u-sofia', mode: 'editing', heartbeatAt: new Date(), user: { name: 'Sofia Delgado', email: 'sofia@archive.com' } },
  ]);
}

describe('U0 draft actions', () => {
  let app: Awaited<ReturnType<typeof loadApp>>;

  beforeEach(async () => {
    resetPrismaMock(mockPrisma);
    waitUntil.mockReset();
    runDelayedSend.mockReset().mockResolvedValue(undefined);
    deleteDraft.mockReset().mockResolvedValue(undefined);
    sendDraft.mockReset().mockResolvedValue(undefined);
    sendAsList.mockReset();
    app = await loadApp();
  });

  describe('POST /api/drafts/:id/send (one-step)', () => {
    it('schedules a PENDING draft with a 10s default undo window and returns immediately', async () => {
      const store = installDraft({ status: 'PENDING' });
      const before = Date.now();
      const res = await request(app).post('/api/drafts/draft-1/send').set('Authorization', AUTH).send({});
      expect(res.status).toBe(202);
      expect(res.body.data).toMatchObject({ id: 'draft-1', status: 'SCHEDULED', undoSeconds: 10 });
      const at = (store.get().scheduledSendAt as Date).getTime();
      expect(at).toBeGreaterThanOrEqual(before + 10_000);
      expect(at).toBeLessThan(before + 12_000);
      expect(store.get()).toMatchObject({ status: 'SCHEDULED', sentByUserId: ME, sendError: null });
      expect(runDelayedSend).toHaveBeenCalledWith('draft-1', 10_000);
      expect(waitUntil).toHaveBeenCalledTimes(1);
      expect(sendDraft).not.toHaveBeenCalled();
      expect(logged('DRAFT_SEND_SCHEDULED')).toMatchObject({ draftId: 'draft-1', actorUserId: ME });
    });

    it('accepts undoSeconds up to 30 and rejects more', async () => {
      installDraft({ status: 'PENDING' });
      const ok = await request(app).post('/api/drafts/draft-1/send').set('Authorization', AUTH).send({ undoSeconds: 30 });
      expect(ok.status).toBe(202);
      expect(runDelayedSend).toHaveBeenCalledWith('draft-1', 30_000);
      installDraft({ status: 'PENDING' });
      const bad = await request(app).post('/api/drafts/draft-1/send').set('Authorization', AUTH).send({ undoSeconds: 31 });
      expect(bad.status).toBe(400);
    });

    it('saves body edits in the same call and records who edited', async () => {
      const store = installDraft({ status: 'PENDING' });
      const res = await request(app)
        .post('/api/drafts/draft-1/send')
        .set('Authorization', AUTH)
        .send({ bodyText: 'Edited text' });
      expect(res.status).toBe(202);
      expect(store.get()).toMatchObject({ bodyText: 'Edited text', aiBodyText: 'AI text', editedByUserId: ME });
      expect(store.get().editedAt).toBeInstanceOf(Date);
      expect(String(store.get().bodyHtml)).toContain('Edited text');
    });

    it('re-sends a FAILED draft and clears its error', async () => {
      const store = installDraft({ status: 'FAILED', sendError: 'Quota exceeded' });
      const res = await request(app).post('/api/drafts/draft-1/send').set('Authorization', AUTH).send({});
      expect(res.status).toBe(202);
      expect(store.get()).toMatchObject({ status: 'SCHEDULED', sendError: null });
    });

    it('clears a snooze when sending', async () => {
      const store = installDraft({ status: 'PENDING', snoozedUntil: new Date(Date.now() + 3600_000) });
      await request(app).post('/api/drafts/draft-1/send').set('Authorization', AUTH).send({});
      expect(store.get().snoozedUntil).toBeNull();
    });

    it.each([
      ['SCHEDULED', /already scheduled/i],
      ['SENDING', /already sent/i],
      ['SENT', /already sent/i],
      ['DISCARDED', /discarded/i],
    ])('409 for a %s draft', async (status, msg) => {
      installDraft({ status });
      const res = await request(app).post('/api/drafts/draft-1/send').set('Authorization', AUTH).send({});
      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(msg);
      expect(runDelayedSend).not.toHaveBeenCalled();
    });

    it('400 when the thread has no candidate to address', async () => {
      installDraft({ status: 'PENDING' });
      mockPrisma.emailDraft.findUnique.mockResolvedValueOnce({ id: 'draft-1', status: 'PENDING', thread: { ...thread, candidate: null } });
      const res = await request(app).post('/api/drafts/draft-1/send').set('Authorization', AUTH).send({});
      expect(res.status).toBe(400);
    });

    it('keeps the legacy APPROVED path (Gmail draft send) until R2 ships', async () => {
      installDraft({ status: 'APPROVED', externalDraftId: 'gd-1' });
      mockPrisma.candidate.update.mockResolvedValue({});
      const res = await request(app).post('/api/drafts/draft-1/send').set('Authorization', AUTH);
      expect(res.status).toBe(200);
      expect(sendDraft).toHaveBeenCalledWith('mb-1', 'gd-1');
      expect(runDelayedSend).not.toHaveBeenCalled();
    });

    it('423 while someone else is editing, naming them', async () => {
      const store = installDraft({ status: 'PENDING' });
      otherUserEditing();
      const res = await request(app).post('/api/drafts/draft-1/send').set('Authorization', AUTH).send({});
      expect(res.status).toBe(423);
      expect(res.body.lockedBy).toBe('Sofia Delgado');
      expect(store.get().status).toBe('PENDING');
    });

    it('override:true sends anyway and logs DRAFT_LOCK_OVERRIDDEN', async () => {
      installDraft({ status: 'PENDING' });
      otherUserEditing();
      const res = await request(app).post('/api/drafts/draft-1/send').set('Authorization', AUTH).send({ override: true });
      expect(res.status).toBe(202);
      expect(logged('DRAFT_LOCK_OVERRIDDEN')).toMatchObject({ draftId: 'draft-1', actorUserId: ME, lockHolderUserId: 'u-sofia', action: 'send' });
    });

    it('someone merely viewing does not lock', async () => {
      installDraft({ status: 'PENDING' });
      mockPrisma.draftPresence.findMany.mockResolvedValue([
        { draftId: 'draft-1', userId: 'u-sofia', mode: 'viewing', heartbeatAt: new Date(), user: { name: 'Sofia', email: 's@a.com' } },
      ]);
      const res = await request(app).post('/api/drafts/draft-1/send').set('Authorization', AUTH).send({});
      expect(res.status).toBe(202);
    });
  });

  describe('POST /api/drafts/:id/undo-send', () => {
    it('puts a SCHEDULED draft back to PENDING', async () => {
      const store = installDraft({ status: 'SCHEDULED', scheduledSendAt: new Date(Date.now() + 5000), sentByUserId: ME });
      const res = await request(app).post('/api/drafts/draft-1/undo-send').set('Authorization', AUTH).send({});
      expect(res.status).toBe(200);
      expect(store.get()).toMatchObject({ status: 'PENDING', scheduledSendAt: null });
      expect(logged('DRAFT_SEND_UNDONE')).toMatchObject({ draftId: 'draft-1', actorUserId: ME });
    });

    it('409 "Already sent" once the send started', async () => {
      installDraft({ status: 'SENDING' });
      const res = await request(app).post('/api/drafts/draft-1/undo-send').set('Authorization', AUTH).send({});
      expect(res.status).toBe(409);
      expect(res.body.error).toBe('Already sent');
    });

    it('404 for an unknown draft', async () => {
      mockPrisma.emailDraft.findUnique.mockResolvedValue(null);
      const res = await request(app).post('/api/drafts/nope/undo-send').set('Authorization', AUTH).send({});
      expect(res.status).toBe(404);
    });

    it('423 while someone else is editing', async () => {
      installDraft({ status: 'SCHEDULED' });
      otherUserEditing();
      const res = await request(app).post('/api/drafts/draft-1/undo-send').set('Authorization', AUTH).send({});
      expect(res.status).toBe(423);
    });
  });

  describe('POST /api/drafts/:id/dismiss', () => {
    it('discards with reason, note and who, and deletes the Gmail draft', async () => {
      const store = installDraft({ status: 'APPROVED', externalDraftId: 'gd-1' });
      const res = await request(app)
        .post('/api/drafts/draft-1/dismiss')
        .set('Authorization', AUTH)
        .send({ reason: 'already_handled', note: 'Replied from my phone' });
      expect(res.status).toBe(200);
      expect(store.get()).toMatchObject({
        status: 'DISCARDED',
        dismissReason: 'already_handled',
        dismissNote: 'Replied from my phone',
        dismissedByUserId: ME,
      });
      expect(deleteDraft).toHaveBeenCalledWith('mb-1', 'gd-1');
      const details = logged('DRAFT_DISMISSED');
      expect(details).toMatchObject({ draftId: 'draft-1', reason: 'already_handled', actorUserId: ME });
      expect(JSON.stringify(details)).not.toContain('Replied from my phone');
    });

    it('cancels a SCHEDULED send', async () => {
      const store = installDraft({ status: 'SCHEDULED' });
      const res = await request(app).post('/api/drafts/draft-1/dismiss').set('Authorization', AUTH).send({});
      expect(res.status).toBe(200);
      expect(store.get().status).toBe('DISCARDED');
    });

    it('rejects an unknown reason', async () => {
      installDraft({ status: 'PENDING' });
      const res = await request(app).post('/api/drafts/draft-1/dismiss').set('Authorization', AUTH).send({ reason: 'meh' });
      expect(res.status).toBe(400);
    });

    it('409 for a sent draft', async () => {
      installDraft({ status: 'SENT' });
      const res = await request(app).post('/api/drafts/draft-1/dismiss').set('Authorization', AUTH).send({});
      expect(res.status).toBe(409);
    });

    it('423 while someone else is editing', async () => {
      installDraft({ status: 'PENDING' });
      otherUserEditing();
      const res = await request(app).post('/api/drafts/draft-1/dismiss').set('Authorization', AUTH).send({});
      expect(res.status).toBe(423);
    });
  });

  describe('snooze', () => {
    it('snoozes until a future time within 30 days', async () => {
      const store = installDraft({ status: 'PENDING', returnedFromSnoozeAt: new Date() });
      const until = new Date(Date.now() + 2 * 86400_000).toISOString();
      const res = await request(app).post('/api/drafts/draft-1/snooze').set('Authorization', AUTH).send({ until });
      expect(res.status).toBe(200);
      expect((store.get().snoozedUntil as Date).toISOString()).toBe(until);
      expect(store.get().returnedFromSnoozeAt).toBeNull();
      expect(logged('DRAFT_SNOOZED')).toMatchObject({ draftId: 'draft-1', actorUserId: ME });
    });

    it.each([
      ['in the past', () => new Date(Date.now() - 1000).toISOString()],
      ['more than 30 days out', () => new Date(Date.now() + 31 * 86400_000).toISOString()],
      ['not a date', () => 'tomorrow'],
    ])('rejects a time %s', async (_label, until) => {
      installDraft({ status: 'PENDING' });
      const res = await request(app).post('/api/drafts/draft-1/snooze').set('Authorization', AUTH).send({ until: until() });
      expect(res.status).toBe(400);
    });

    it('409 for a sent draft', async () => {
      installDraft({ status: 'SENT' });
      const until = new Date(Date.now() + 86400_000).toISOString();
      const res = await request(app).post('/api/drafts/draft-1/snooze').set('Authorization', AUTH).send({ until });
      expect(res.status).toBe(409);
    });

    it('unsnooze returns it to the queue now', async () => {
      const store = installDraft({ status: 'PENDING', snoozedUntil: new Date(Date.now() + 86400_000) });
      const res = await request(app).post('/api/drafts/draft-1/unsnooze').set('Authorization', AUTH).send({});
      expect(res.status).toBe(200);
      expect(store.get().snoozedUntil).toBeNull();
    });
  });

  describe('presence', () => {
    it('POST heartbeats and returns who else is here', async () => {
      installDraft({ status: 'PENDING' });
      mockPrisma.draftPresence.upsert.mockResolvedValue({});
      mockPrisma.draftPresence.deleteMany.mockResolvedValue({ count: 0 });
      otherUserEditing();
      const res = await request(app).post('/api/drafts/draft-1/presence').set('Authorization', AUTH).send({ mode: 'viewing' });
      expect(res.status).toBe(200);
      expect(mockPrisma.draftPresence.upsert).toHaveBeenCalledWith(expect.objectContaining({
        where: { draftId_userId: { draftId: 'draft-1', userId: ME } },
        update: expect.objectContaining({ mode: 'viewing' }),
      }));
      expect(res.body.data.presence).toEqual([{ userId: 'u-sofia', name: 'Sofia Delgado', mode: 'editing' }]);
    });

    it('rejects an unknown mode', async () => {
      installDraft({ status: 'PENDING' });
      const res = await request(app).post('/api/drafts/draft-1/presence').set('Authorization', AUTH).send({ mode: 'lurking' });
      expect(res.status).toBe(400);
    });

    it('DELETE clears my presence', async () => {
      mockPrisma.draftPresence.deleteMany.mockResolvedValue({ count: 1 });
      const res = await request(app).delete('/api/drafts/draft-1/presence').set('Authorization', AUTH);
      expect(res.status).toBe(200);
      expect(mockPrisma.draftPresence.deleteMany).toHaveBeenCalledWith({ where: { draftId: 'draft-1', userId: ME } });
    });

    it('GET /:id includes others\' presence (not mine), confidenceLabel and the AI/edited bodies', async () => {
      installDraft({ status: 'PENDING', bodyText: 'Edited', aiBodyText: 'AI text', confidence: 0.72 });
      otherUserEditing();
      const res = await request(app).get('/api/drafts/draft-1').set('Authorization', AUTH);
      expect(res.status).toBe(200);
      expect(mockPrisma.draftPresence.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ userId: { not: ME } }),
      }));
      expect(res.body.data).toMatchObject({
        presence: [{ userId: 'u-sofia', name: 'Sofia Delgado', mode: 'editing' }],
        confidenceLabel: 'medium',
        bodyText: 'Edited',
        aiBodyText: 'AI text',
        hasEdits: true,
      });
    });
  });

  describe('PATCH /api/drafts/:id edit tracking + lock', () => {
    it('records editedAt/editedByUserId on a body edit', async () => {
      const store = installDraft({ status: 'PENDING' });
      const res = await request(app).patch('/api/drafts/draft-1').set('Authorization', AUTH).send({ bodyText: 'Mine now' });
      expect(res.status).toBe(200);
      expect(store.get()).toMatchObject({ bodyText: 'Mine now', editedByUserId: ME });
      expect(store.get().editedAt).toBeInstanceOf(Date);
    });

    it('reverting to the AI text clears the edit marker', async () => {
      const store = installDraft({ status: 'PENDING', bodyText: 'Mine', editedAt: new Date(), editedByUserId: ME });
      await request(app).patch('/api/drafts/draft-1').set('Authorization', AUTH).send({ bodyText: 'AI text' });
      expect(store.get()).toMatchObject({ bodyText: 'AI text', editedAt: null, editedByUserId: null });
    });

    it('423 while someone else is editing', async () => {
      installDraft({ status: 'PENDING' });
      otherUserEditing();
      const res = await request(app).patch('/api/drafts/draft-1').set('Authorization', AUTH).send({ bodyText: 'x' });
      expect(res.status).toBe(423);
      expect(res.body.lockedBy).toBe('Sofia Delgado');
    });
  });

  describe('POST /api/drafts/:id/dictate', () => {
    it('counts as a recruiter edit', async () => {
      const store = installDraft({ status: 'PENDING' });
      rewriteDraftWithNotes.mockResolvedValueOnce({ bodyText: 'Rewritten' });
      const res = await request(app).post('/api/drafts/draft-1/dictate').set('Authorization', AUTH).send({ notes: 'shorter' });
      expect(res.status).toBe(200);
      expect(store.get()).toMatchObject({ bodyText: 'Rewritten', aiBodyText: 'AI text', editedByUserId: ME });
    });

    it('423 while someone else is editing', async () => {
      installDraft({ status: 'PENDING' });
      otherUserEditing();
      const res = await request(app).post('/api/drafts/draft-1/dictate').set('Authorization', AUTH).send({ notes: 'x' });
      expect(res.status).toBe(423);
      expect(rewriteDraftWithNotes).not.toHaveBeenCalled();
    });
  });
});
