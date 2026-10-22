import type { MailboxSyncHealth } from './api';
import { mailboxHealthState } from './mailboxHealth';

export interface BannerIssue {
  mailboxId: string;
  emailAddress: string;
}

/** Mailboxes a human must reconnect: OAuth revoked or Gmail watch expired. */
export function bannerIssues(rows: MailboxSyncHealth[]): BannerIssue[] {
  return rows
    .filter((r) => mailboxHealthState(r) === 'reconnect')
    .map((r) => ({ mailboxId: r.mailboxId, emailAddress: r.emailAddress }));
}

const KEY_PREFIX = 'statusBanner:dismissed:';

/** Dismissal is per session and per set of issues: a new issue re-shows it. */
export function dismissKey(issues: BannerIssue[]): string {
  return KEY_PREFIX + issues.map((i) => i.mailboxId).sort().join(',');
}

export function isDismissed(issues: BannerIssue[]): boolean {
  try {
    return window.sessionStorage.getItem(dismissKey(issues)) === '1';
  } catch {
    return false;
  }
}

export function dismiss(issues: BannerIssue[]): void {
  try {
    window.sessionStorage.setItem(dismissKey(issues), '1');
  } catch {
    // Storage unavailable: dismissal lasts until the next render only.
  }
}
