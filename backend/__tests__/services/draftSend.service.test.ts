// U0 one-step send state machine: SCHEDULED → SENDING → SENT | FAILED, with
// every transition a compare-and-set so two runners (waitUntil timer + sweep
// cron, or two timers after undo/re-send) can never send twice.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildPrismaMock, resetPrismaMock, type MockPrisma } from '../_setup/mockPrisma';

const { sendMessage, deleteDraft } = vi.hoisted(() => ({ sendMessage: vi.fn(), deleteDraft: vi.fn() }));

vi.mock('../../src/services/gmail.service', () => ({ sendMessage, deleteDraft }));
vi.mock('../../src/db/client', () => {
  const prisma = buildPrismaMock();
  return { prisma, default: prisma };
});

import { prisma as injectedPrisma } from '../../src/db/client';
import {
  executeScheduledSend,
  runDelayedSend,
  runDelayedSendBatch,
  sweepScheduledSends,
  undoScheduledSend,
  SWEEP_GRACE_MS,
  SENDING_STUCK_MS,
} from '../../src/services/draftSend.service';
const mockPrisma = injectedPrisma as unknown as MockPrisma;

const NOW = new Date('2026-10-22T15:00:00Z');
const thread = {
  id: 'thread-1',
  externalThreadId: 'ext-thread-1',
  mailbox: { id: 'mb-1', emailAddress: 'aaron@archive.com', provider: 'GMAIL' },
  candidate: { id: 'cand-1', email: 'jane@example.com' },
};

/** One-row store whose updateMany honours the where clause like Postgres would. */
function installRow(initial: Record<string, unknown>) {
  let row: Record<string, unknown> = {
    id: 'draft-1',
    threadId: 'thread-1',
    subject: 'Re: opportunity',
    bodyText: 'Hi Jane',
    bodyHtml: '<div>Hi Jane</div>',
    inReplyToMessageId: '<abc@mail.example.com>',
    referencesHeader: '<abc@mail.example.com>',
    ccEmail: 'sofia@archive.com',
    externalDraftId: null,
    sentByUserId: 'user-a',
    ...initial,
  };
  const matches = (where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => {
      const cur = row[k] ?? null;
      if (v && typeof v === 'object' && !(v instanceof Date)) {
        const op = v as { in?: unknown[]; lte?: Date; lt?: Date };
        if (op.in) return op.in.includes(cur);
        if (op.lte) return cur instanceof Date && cur.getTime() <= op.lte.getTime();
        if (op.lt) return cur instanceof Date && cur.getTime() < op.lt.getTime();
      }
      return cur === v;
    });
  mockPrisma.emailDraft.updateMany.mockImplementation(async ({ where, data }) => {
    if (!matches(where)) return { count: 0 };
    row = { ...row, ...data };
    return { count: 1 };
  });
  mockPrisma.emailDraft.findUnique.mockImplementation(async () => ({ ...row, thread }));
  return { get: () => row };
}

describe('draftSend.service (U0)', () => {
  beforeEach(() => {
    resetPrismaMock(mockPrisma);
    sendMessage.mockReset().mockResolvedValue({ id: 'gm-1', threadId: 'ext-thread-1' });
    deleteDraft.mockReset().mockResolvedValue(undefined);
    mockPrisma.candidate.update.mockResolvedValue({});
  });

  describe('executeScheduledSend', () => {
    it('sends a due SCHEDULED draft with its threading headers and CC, then marks it SENT', async () => {
      const store = installRow({ status: 'SCHEDULED', scheduledSendAt: new Date(NOW.getTime() - 1000) });
      await expect(executeScheduledSend('draft-1', NOW)).resolves.toBe('sent');
      expect(sendMessage).toHaveBeenCalledWith('mb-1', expect.objectContaining({
        externalThreadId: 'ext-thread-1',
        inReplyToMessageId: '<abc@mail.example.com>',
        referencesHeader: '<abc@mail.example.com>',
        toAddress: 'jane@example.com',
        ccEmail: 'sofia@archive.com',
      }));
      expect(store.get().status).toBe('SENT');
      expect(store.get().sentAt).toBeInstanceOf(Date);
      expect(mockPrisma.candidate.update).toHaveBeenCalledWith({
        where: { id: 'cand-1' },
        data: { repliedAt: expect.any(Date), lastOutboundAt: expect.any(Date) },
      });
    });

    it('two concurrent runners send exactly once', async () => {
      installRow({ status: 'SCHEDULED', scheduledSendAt: new Date(NOW.getTime() - 1000) });
      const results = await Promise.all([executeScheduledSend('draft-1', NOW), executeScheduledSend('draft-1', NOW)]);
      expect(results.sort()).toEqual(['sent', 'skipped']);
      expect(sendMessage).toHaveBeenCalledTimes(1);
    });

    it('a stale timer does not send a draft that was undone and re-scheduled for later', async () => {
      const store = installRow({ status: 'SCHEDULED', scheduledSendAt: new Date(NOW.getTime() + 8000) });
      await expect(executeScheduledSend('draft-1', NOW)).resolves.toBe('skipped');
      expect(sendMessage).not.toHaveBeenCalled();
      expect(store.get().status).toBe('SCHEDULED');
    });

    it('skips a draft that was undone (back to PENDING)', async () => {
      installRow({ status: 'PENDING', scheduledSendAt: null });
      await expect(executeScheduledSend('draft-1', NOW)).resolves.toBe('skipped');
      expect(sendMessage).not.toHaveBeenCalled();
    });

    it('a Gmail failure marks the draft FAILED with a sanitized error and no candidate update', async () => {
      const store = installRow({ status: 'SCHEDULED', scheduledSendAt: new Date(NOW.getTime() - 1000) });
      sendMessage.mockRejectedValueOnce(new Error('Quota exceeded'));
      await expect(executeScheduledSend('draft-1', NOW)).resolves.toBe('failed');
      expect(store.get().status).toBe('FAILED');
      expect(store.get().sendError).toContain('Quota exceeded');
      expect(mockPrisma.candidate.update).not.toHaveBeenCalled();
    });

    it('removes a leftover Gmail draft after sending', async () => {
      installRow({ status: 'SCHEDULED', scheduledSendAt: new Date(NOW.getTime() - 1000), externalDraftId: 'gd-1' });
      await executeScheduledSend('draft-1', NOW);
      expect(deleteDraft).toHaveBeenCalledWith('mb-1', 'gd-1');
    });
  });

  describe('runDelayedSend', () => {
    afterEach(() => vi.useRealTimers());

    it('waits out the undo window, then sends', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(NOW);
      installRow({ status: 'SCHEDULED', scheduledSendAt: new Date(NOW.getTime() + 10_000) });
      const p = runDelayedSend('draft-1', 10_000);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(sendMessage).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(6_000);
      await p;
      expect(sendMessage).toHaveBeenCalledTimes(1);
    });

    it('sends nothing when undone inside the window', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(NOW);
      installRow({ status: 'SCHEDULED', scheduledSendAt: new Date(NOW.getTime() + 10_000) });
      const p = runDelayedSend('draft-1', 10_000);
      await vi.advanceTimersByTimeAsync(3_000);
      await expect(undoScheduledSend('draft-1')).resolves.toBe('undone');
      await vi.advanceTimersByTimeAsync(10_000);
      await p;
      expect(sendMessage).not.toHaveBeenCalled();
    });
  });

  describe('undoScheduledSend', () => {
    it('returns a SCHEDULED draft to PENDING', async () => {
      const store = installRow({ status: 'SCHEDULED', scheduledSendAt: NOW });
      await expect(undoScheduledSend('draft-1')).resolves.toBe('undone');
      expect(store.get()).toMatchObject({ status: 'PENDING', scheduledSendAt: null, sentByUserId: null });
    });

    it('is too late once a runner claimed the draft', async () => {
      installRow({ status: 'SENDING' });
      await expect(undoScheduledSend('draft-1')).resolves.toBe('already_sent');
    });

    it('is too late once sent', async () => {
      installRow({ status: 'SENT' });
      await expect(undoScheduledSend('draft-1')).resolves.toBe('already_sent');
    });

    it('reports a draft that was never scheduled', async () => {
      installRow({ status: 'PENDING' });
      await expect(undoScheduledSend('draft-1')).resolves.toBe('not_scheduled');
    });
  });

  describe('sweepScheduledSends (fallback for a lost waitUntil)', () => {
    it('only picks SCHEDULED drafts more than 60s past due', async () => {
      mockPrisma.emailDraft.findMany.mockResolvedValueOnce([]);
      mockPrisma.emailDraft.updateMany.mockResolvedValue({ count: 0 });
      await sweepScheduledSends(NOW);
      expect(SWEEP_GRACE_MS).toBe(60_000);
      expect(mockPrisma.emailDraft.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { status: 'SCHEDULED', scheduledSendAt: { lt: new Date(NOW.getTime() - 60_000) } },
      }));
    });

    it('sends what it finds', async () => {
      installRow({ status: 'SCHEDULED', scheduledSendAt: new Date(NOW.getTime() - 120_000) });
      mockPrisma.emailDraft.findMany.mockResolvedValueOnce([{ id: 'draft-1' }]);
      const out = await sweepScheduledSends(NOW);
      expect(out.sent).toBe(1);
      expect(sendMessage).toHaveBeenCalledTimes(1);
    });

    it('fails a draft stuck in SENDING instead of re-sending it', async () => {
      const store = installRow({ status: 'SENDING', updatedAt: new Date(NOW.getTime() - SENDING_STUCK_MS - 1000) });
      mockPrisma.emailDraft.findMany.mockResolvedValueOnce([]);
      const out = await sweepScheduledSends(NOW);
      expect(out.interrupted).toBe(1);
      expect(store.get().status).toBe('FAILED');
      expect(String(store.get().sendError)).toMatch(/Gmail Sent/);
      expect(sendMessage).not.toHaveBeenCalled();
    });
  });
});

describe('runDelayedSendBatch', () => {
  afterEach(() => vi.useRealTimers());

  it('waits once, then sends the drafts one after another', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    resetPrismaMock(mockPrisma);
    sendMessage.mockReset();
    const order: string[] = [];
    mockPrisma.emailDraft.updateMany.mockImplementation(async ({ where }) =>
      where.status === 'SCHEDULED' ? (order.push(where.id), { count: 1 }) : { count: 1 }
    );
    mockPrisma.emailDraft.findUnique.mockImplementation(async ({ where }) => ({
      id: where.id, subject: 's', bodyText: 'b', bodyHtml: null, ccEmail: null, externalDraftId: null, thread,
    }));
    mockPrisma.candidate.update.mockResolvedValue({});
    sendMessage.mockResolvedValue({ id: 'x', threadId: 'y' });

    const p = runDelayedSendBatch(['a', 'b', 'c'], 10_000);
    await vi.advanceTimersByTimeAsync(9_000);
    expect(order).toEqual([]);
    await vi.advanceTimersByTimeAsync(2_000);
    await p;
    expect(order).toEqual(['a', 'b', 'c']);
    expect(sendMessage).toHaveBeenCalledTimes(3);
  });
});
