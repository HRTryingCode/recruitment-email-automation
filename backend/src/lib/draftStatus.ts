/**
 * EmailDraft.status values (U0 inbox).
 *
 *   PENDING   — waiting for a recruiter decision
 *   APPROVED  — legacy two-step flow: Gmail draft created, not yet sent
 *               (deprecated; kept until the R2 inbox UI ships)
 *   SCHEDULED — one-step send queued; undoable until scheduledSendAt
 *   SENDING   — a runner claimed it and is talking to Gmail
 *   SENT / DISCARDED — terminal
 *   FAILED    — the Gmail send threw; sendError says why, can be re-sent
 */
export type DraftStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'SCHEDULED'
  | 'SENDING'
  | 'SENT'
  | 'FAILED'
  | 'DISCARDED';

/**
 * At most one draft per thread in these states. Mirrors the WHERE clause of
 * the partial unique index "EmailDraft_threadId_live_key" (migration
 * 9g_inbox); __tests__/lib/draftStatus.test.ts keeps the two in sync.
 */
export const LIVE_DRAFT_STATUSES: DraftStatus[] = ['PENDING', 'APPROVED', 'SCHEDULED', 'SENDING', 'FAILED'];

/**
 * Live drafts that may be discarded (ignore, manual reply, dismiss). SENDING
 * is excluded: Gmail may already have the message.
 */
export const CANCELABLE_DRAFT_STATUSES: DraftStatus[] = ['PENDING', 'APPROVED', 'SCHEDULED', 'FAILED'];

/**
 * PENDING drafts older than this are treated as expired: they leave the
 * review queue and the inbox's live views (M16). Derived from createdAt.
 */
export const DRAFT_EXPIRY_DAYS = 21;

/** When a waiting (PENDING/APPROVED) draft expires; null for any other status. */
export function draftExpiresAt(status: string, createdAt: Date): Date | null {
  if (status !== 'PENDING' && status !== 'APPROVED') return null;
  return new Date(new Date(createdAt).getTime() + DRAFT_EXPIRY_DAYS * 86_400_000);
}
