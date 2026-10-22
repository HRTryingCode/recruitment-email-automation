import type { MailboxSyncHealth } from './api';

/**
 * Mailbox health classification for the dashboard pill, accordion and
 * account rows (audit M6). Ranked worst-first:
 *
 *   reconnect — OAuth grant revoked (NEEDS_REAUTH) or Gmail watch expired.
 *               Nothing is being ingested; a human must reconnect.
 *   failing   — reconcile failed 3+ times in a row or hasn't succeeded in 3h.
 *   ok        — everything else.
 *
 * Webhook errors and drift use rate thresholds so the pill isn't permanently
 * red (most mail arrives via reconcile, so small drift is normal).
 */
export type MailboxHealthState = 'reconnect' | 'failing' | 'ok';

const RECONCILE_STALE_MS = 3 * 60 * 60 * 1000;
const RECONCILE_FAILURE_STREAK = 3;
const WEBHOOK_ERRORS_ELEVATED = 10;
const DRIFT_HIGH = 10;

export function mailboxHealthState(row: MailboxSyncHealth, now: number = Date.now()): MailboxHealthState {
  if (row.authStatus === 'NEEDS_REAUTH') return 'reconnect';
  if (row.watchExpiresInHours !== null && row.watchExpiresInHours < 0) return 'reconnect';
  if (row.consecutiveReconcileFailures >= RECONCILE_FAILURE_STREAK) return 'failing';
  if (!row.lastReconciliationAt || now - new Date(row.lastReconciliationAt).getTime() > RECONCILE_STALE_MS) {
    return 'failing';
  }
  return 'ok';
}

export interface HealthSummary {
  tone: 'emerald' | 'amber' | 'rose' | 'neutral';
  label: string;
  /** True for rose states — the dashboard auto-expands the health accordion. */
  unhealthy: boolean;
}

function mailboxes(n: number): string {
  return `${n} mailbox${n === 1 ? '' : 'es'}`;
}

export function summarizeHealth(data: MailboxSyncHealth[], now: number = Date.now()): HealthSummary {
  if (data.length === 0) return { tone: 'neutral', label: 'No mailbox health data', unhealthy: false };

  const states = data.map((d) => mailboxHealthState(d, now));
  const reconnect = states.filter((s) => s === 'reconnect').length;
  if (reconnect > 0) {
    return { tone: 'rose', label: `${mailboxes(reconnect)}: reconnect required`, unhealthy: true };
  }
  const failing = states.filter((s) => s === 'failing').length;
  if (failing > 0) {
    return { tone: 'rose', label: `${mailboxes(failing)} not syncing`, unhealthy: true };
  }
  if (data.some((d) => d.error)) return { tone: 'amber', label: 'Health data incomplete', unhealthy: false };
  if (data.some((d) => d.webhookErrorsLast24h >= WEBHOOK_ERRORS_ELEVATED)) {
    return { tone: 'amber', label: 'More Gmail delivery errors than usual', unhealthy: false };
  }
  if (data.some((d) => d.lastReconciliationFoundMissing >= DRIFT_HIGH)) {
    return { tone: 'amber', label: 'Catch-up sync is finding missed emails', unhealthy: false };
  }
  const expiringSoon = data.filter(
    (d) => d.watchExpiresInHours !== null && d.watchExpiresInHours < 24
  ).length;
  if (expiringSoon > 0) {
    return {
      tone: 'amber',
      label: `Live updates expire soon for ${expiringSoon} mailbox${expiringSoon === 1 ? '' : 'es'}`,
      unhealthy: false,
    };
  }
  return { tone: 'emerald', label: 'All mailboxes healthy', unhealthy: false };
}

/** Compact "live updates renew in" label: −3h, < 1h, 12h, 5d, or "off". */
export function formatWatchExpiry(h: number | null): string {
  if (h === null) return 'off';
  if (h < 0) return `−${Math.abs(Math.round(h))}h`;
  if (h < 1) return `< 1h`;
  if (h < 48) return `${Math.round(h)}h`;
  return `${Math.round(h / 24)}d`;
}

/** Local part + "@" for compact copy: "aaronrampersad@archive.com" → "aaronrampersad@". */
export function shortAddress(email: string): string {
  const at = email.indexOf('@');
  return at === -1 ? email : email.slice(0, at + 1);
}
