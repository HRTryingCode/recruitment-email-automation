// One-step send with undo (U0).
//
//   POST /send     PENDING|FAILED → SCHEDULED (scheduledSendAt = now + undo)
//   POST /undo     SCHEDULED → PENDING, only before a runner claims it
//   runner         SCHEDULED (due) → SENDING → SENT | FAILED
//
// A runner is either the waitUntil timer started by POST /send or the sweep
// cron (for a timer lost to a frozen function). Every transition is a
// compare-and-set updateMany, so two runners — or a stale timer after an
// undo + re-send — can never send the same draft twice.
import { prisma } from '../db/client';
import { sendMessage, deleteDraft } from './gmail.service';
import { logEvent } from './monitoring.service';
import { safeError } from '../lib/safeError';

/** The sweep only takes over drafts this far past due, so it doesn't race a live timer. */
export const SWEEP_GRACE_MS = 60_000;
/** A SENDING row older than this was interrupted mid-send (function killed). */
export const SENDING_STUCK_MS = 10 * 60_000;
/** Timer slack so the runner never wakes a hair before scheduledSendAt. */
const TIMER_SLACK_MS = 250;
const SWEEP_BATCH = 25;
const MAX_SEND_ERROR_CHARS = 500;

export const INTERRUPTED_SEND_ERROR =
  'Send was interrupted before Gmail confirmed it. Check the Gmail Sent folder before re-sending.';

export type SendOutcome = 'sent' | 'skipped' | 'failed';

async function markFailed(draftId: string, message: string): Promise<void> {
  await prisma.emailDraft.updateMany({
    where: { id: draftId, status: 'SENDING' },
    data: { status: 'FAILED', sendError: message.slice(0, MAX_SEND_ERROR_CHARS) },
  });
  await logEvent('DRAFT_SEND_FAILED', { draftId, error: message.slice(0, MAX_SEND_ERROR_CHARS) }, 'ERROR');
}

/**
 * Send one SCHEDULED draft if it is due. Returns 'skipped' when it was undone,
 * re-scheduled for later, or already claimed by another runner.
 */
export async function executeScheduledSend(draftId: string, now: Date = new Date()): Promise<SendOutcome> {
  const claimed = await prisma.emailDraft.updateMany({
    where: { id: draftId, status: 'SCHEDULED', scheduledSendAt: { lte: now } },
    data: { status: 'SENDING' },
  });
  if (claimed.count === 0) return 'skipped';

  const draft = await prisma.emailDraft.findUnique({
    where: { id: draftId },
    include: { thread: { include: { mailbox: true, candidate: true } } },
  });
  const thread = draft?.thread;
  if (!draft || !thread?.candidate) {
    await markFailed(draftId, 'Cannot send: thread has no candidate to address');
    return 'failed';
  }
  if (thread.mailbox.provider !== 'GMAIL') {
    await markFailed(draftId, `Cannot send from a ${thread.mailbox.provider} mailbox`);
    return 'failed';
  }

  try {
    await sendMessage(thread.mailbox.id, {
      threadId: thread.id,
      externalThreadId: thread.externalThreadId,
      subject: draft.subject,
      bodyText: draft.bodyText,
      bodyHtml: draft.bodyHtml ?? undefined,
      inReplyToMessageId: draft.inReplyToMessageId ?? undefined,
      referencesHeader: draft.referencesHeader ?? undefined,
      toAddress: thread.candidate.email,
      ccEmail: draft.ccEmail,
    });
  } catch (err) {
    await markFailed(draftId, safeError(err).message);
    return 'failed';
  }

  const sentAt = new Date();
  await prisma.emailDraft.updateMany({
    where: { id: draftId, status: 'SENDING' },
    data: { status: 'SENT', sentAt, sendError: null },
  });
  // Conversation state only; the interest classification stays (H6).
  await prisma.candidate.update({
    where: { id: thread.candidate.id },
    data: { repliedAt: sentAt, lastOutboundAt: sentAt },
  });
  // A Gmail draft left over from the legacy approve step would otherwise
  // sit in Drafts and could be sent a second time by hand.
  if (draft.externalDraftId) {
    try {
      await deleteDraft(thread.mailbox.id, draft.externalDraftId);
    } catch {
      // Already gone or not deletable; the reply itself went out.
    }
  }
  await logEvent('DRAFT_SENT', { draftId, actorUserId: draft.sentByUserId, via: 'scheduled' }, 'INFO');
  return 'sent';
}

/** Body of the waitUntil job POST /send starts: sleep out the undo window, then send. */
export async function runDelayedSend(draftId: string, delayMs: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, delayMs) + TIMER_SLACK_MS));
  try {
    await executeScheduledSend(draftId);
  } catch (err) {
    // The row stays SCHEDULED (or SENDING); the sweep cron picks it up.
    await logEvent('DRAFT_SEND_RUNNER_ERROR', { draftId, error: safeError(err).message }, 'WARN');
  }
}

export type UndoOutcome = 'undone' | 'already_sent' | 'not_scheduled';

export async function undoScheduledSend(draftId: string): Promise<UndoOutcome> {
  const undone = await prisma.emailDraft.updateMany({
    where: { id: draftId, status: 'SCHEDULED' },
    data: { status: 'PENDING', scheduledSendAt: null, sentByUserId: null },
  });
  if (undone.count > 0) return 'undone';
  const current = await prisma.emailDraft.findUnique({ where: { id: draftId }, select: { status: true } });
  return current?.status === 'SENDING' || current?.status === 'SENT' ? 'already_sent' : 'not_scheduled';
}

/**
 * Cron fallback (runs inside sweep-stuck-messages, every 10 min): sends
 * SCHEDULED drafts whose timer was lost, and fails SENDING rows that were
 * interrupted. Those are never re-sent automatically — Gmail may have the
 * message already — so a human checks Sent and re-sends.
 */
export async function sweepScheduledSends(
  now: Date = new Date()
): Promise<{ sent: number; failed: number; skipped: number; interrupted: number }> {
  const out = { sent: 0, failed: 0, skipped: 0, interrupted: 0 };

  const due = await prisma.emailDraft.findMany({
    where: { status: 'SCHEDULED', scheduledSendAt: { lt: new Date(now.getTime() - SWEEP_GRACE_MS) } },
    select: { id: true },
    orderBy: { scheduledSendAt: 'asc' },
    take: SWEEP_BATCH,
  });
  for (const { id } of due) {
    const result = await executeScheduledSend(id, now);
    out[result] += 1;
  }

  const stuck = await prisma.emailDraft.updateMany({
    where: { status: 'SENDING', updatedAt: { lt: new Date(now.getTime() - SENDING_STUCK_MS) } },
    data: { status: 'FAILED', sendError: INTERRUPTED_SEND_ERROR },
  });
  out.interrupted = stuck.count;
  if (stuck.count > 0) {
    await logEvent('DRAFT_SEND_INTERRUPTED', { count: stuck.count }, 'WARN');
  }
  return out;
}
