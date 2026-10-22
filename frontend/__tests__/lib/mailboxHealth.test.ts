import { describe, it, expect } from 'vitest';
import { summarizeHealth, mailboxHealthState } from '../../src/lib/mailboxHealth';
import type { MailboxSyncHealth } from '../../src/lib/api';

const NOW = new Date('2026-10-22T12:00:00Z').getTime();
const minsAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

function row(o: Partial<MailboxSyncHealth> = {}): MailboxSyncHealth {
  return {
    mailboxId: 'mb',
    emailAddress: 'a@archive.com',
    displayName: null,
    isActive: true,
    authStatus: 'OK',
    lastAuthError: null,
    lastAuthErrorAt: null,
    watchExpiry: null,
    watchExpiresInHours: 120,
    lastSyncedMessageAt: minsAgo(30),
    lastReconciliationAt: minsAgo(20),
    lastReconciliationFoundMissing: 2,
    lastReconcileError: null,
    consecutiveReconcileFailures: 0,
    messagesLast24h: 10,
    totalMessages: 100,
    totalCandidates: 5,
    pendingDrafts: 1,
    candidatesNeedsReview: 0,
    webhookErrorsLast24h: 1,
    lastWebhookError: null,
    error: false,
    ...o,
  };
}

describe('mailboxHealthState', () => {
  it('treats a negative watch expiry as reconnect-required, not "expiring soon"', () => {
    // sofia@: watch lapsed ~3,500h ago.
    expect(mailboxHealthState(row({ watchExpiresInHours: -3500 }), NOW)).toBe('reconnect');
  });

  it('treats NEEDS_REAUTH as reconnect-required', () => {
    expect(mailboxHealthState(row({ authStatus: 'NEEDS_REAUTH' }), NOW)).toBe('reconnect');
  });

  it('flags repeated reconcile failures and stale reconciles', () => {
    expect(mailboxHealthState(row({ consecutiveReconcileFailures: 3 }), NOW)).toBe('failing');
    expect(mailboxHealthState(row({ lastReconciliationAt: minsAgo(200) }), NOW)).toBe('failing');
    expect(mailboxHealthState(row({ lastReconciliationAt: null }), NOW)).toBe('failing');
  });

  it('is ok for a normal mailbox with a little drift and one webhook error', () => {
    expect(mailboxHealthState(row(), NOW)).toBe('ok');
  });
});

describe('summarizeHealth', () => {
  it('ranks reconnect-required above every other state, as destructive', () => {
    const s = summarizeHealth(
      [
        row({ mailboxId: '1', webhookErrorsLast24h: 50 }),
        row({ mailboxId: '2', watchExpiresInHours: -3500 }),
        row({ mailboxId: '3', authStatus: 'NEEDS_REAUTH' }),
        row({ mailboxId: '4', consecutiveReconcileFailures: 5 }),
      ],
      NOW
    );
    expect(s.tone).toBe('destructive');
    expect(s.label).toBe('2 mailboxes: reconnect required');
    expect(s.unhealthy).toBe(true);
  });

  it('uses singular wording for one mailbox', () => {
    expect(summarizeHealth([row({ authStatus: 'NEEDS_REAUTH' })], NOW).label).toBe(
      '1 mailbox: reconnect required'
    );
  });

  it('shows reconcile failures as destructive when nothing needs reconnect', () => {
    const s = summarizeHealth([row({ consecutiveReconcileFailures: 4 })], NOW);
    expect(s).toMatchObject({ tone: 'destructive', label: '1 mailbox not syncing', unhealthy: true });
  });

  it('does not go red for a handful of webhook errors or small drift (alarm fatigue)', () => {
    const s = summarizeHealth([row({ webhookErrorsLast24h: 3, lastReconciliationFoundMissing: 4 })], NOW);
    expect(s).toMatchObject({ tone: 'success', label: 'All mailboxes healthy', unhealthy: false });
  });

  it('uses warning for high webhook error rates and high drift', () => {
    expect(summarizeHealth([row({ webhookErrorsLast24h: 25 })], NOW)).toMatchObject({
      tone: 'warning',
      label: 'More Gmail delivery errors than usual',
    });
    expect(summarizeHealth([row({ lastReconciliationFoundMissing: 30 })], NOW)).toMatchObject({
      tone: 'warning',
      label: 'Catch-up sync is finding missed emails',
    });
  });

  it('warns when rows could not be fully computed', () => {
    expect(summarizeHealth([row({ error: true })], NOW)).toMatchObject({
      tone: 'warning',
      label: 'Health data incomplete',
    });
  });

  it('keeps "expiring soon" for watches between 0 and 24h', () => {
    expect(summarizeHealth([row({ watchExpiresInHours: 5 })], NOW)).toMatchObject({
      tone: 'warning',
      label: 'Live updates expire soon for 1 mailbox',
    });
  });

  it('is neutral with no data', () => {
    expect(summarizeHealth([], NOW).tone).toBe('secondary');
  });
});
