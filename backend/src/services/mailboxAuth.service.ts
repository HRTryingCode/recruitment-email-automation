import { prisma } from '../db/client';
import { logEvent } from './monitoring.service';
import { safeError } from '../lib/safeError';

export const AUTH_STATUS_OK = 'OK';
export const AUTH_STATUS_NEEDS_REAUTH = 'NEEDS_REAUTH';

/**
 * Flip a mailbox to NEEDS_REAUTH after Google rejected its OAuth grant
 * (invalid_grant / 401). Idempotent per incident: the conditional
 * updateMany only matches while the row is still OK, so concurrent or
 * repeated failures (webhook, reconcile, renew) write exactly one
 * MAILBOX_AUTH_REVOKED ERROR log. Slack alerting happens in the watchdog
 * cron, which alerts on state change.
 *
 * Returns true if this call performed the OK -> NEEDS_REAUTH transition.
 * Never throws — the caller is already handling a failure.
 */
export async function markMailboxNeedsReauth(
  mailbox: { id: string; emailAddress: string },
  err: unknown,
  source: string
): Promise<boolean> {
  const { message, code, status } = safeError(err);
  try {
    const res = await prisma.mailbox.updateMany({
      where: { id: mailbox.id, authStatus: { not: AUTH_STATUS_NEEDS_REAUTH } },
      data: {
        authStatus: AUTH_STATUS_NEEDS_REAUTH,
        lastAuthError: message,
        lastAuthErrorAt: new Date(),
      },
    });
    if (res.count === 0) return false;
  } catch (dbErr) {
    console.error('[MailboxAuth] Failed to mark mailbox NEEDS_REAUTH:', mailbox.id, safeError(dbErr));
    return false;
  }

  console.error(`[MailboxAuth] ${mailbox.emailAddress} needs reconnect (${source}): ${message}`);
  await logEvent(
    'MAILBOX_AUTH_REVOKED',
    { mailboxId: mailbox.id, emailAddress: mailbox.emailAddress, source, error: message, code, status },
    'ERROR'
  );
  return true;
}
