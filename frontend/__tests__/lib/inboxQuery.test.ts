import { describe, expect, it, vi } from 'vitest';
import * as api from '../../src/lib/api';
import { INBOX_POLL_MS, inboxQueryOptions, inboxSortFrom, inboxViewFrom, waitingCount } from '../../src/lib/inboxQuery';

vi.mock('../../src/lib/api', () => ({ fetchInbox: vi.fn() }));

describe('inboxQueryOptions', () => {
  it('keys by view, mailbox, sort and roles (the Inbox page key) and polls every 15s', () => {
    const o = inboxQueryOptions({ view: 'needs_review' });
    expect(o.queryKey).toEqual(['inbox', 'needs_review', null, 'newest', []]);
    expect(inboxQueryOptions({ view: 'interested', mailboxId: 'mb1', sort: 'oldest', roles: ['SDR'] }).queryKey).toEqual([
      'inbox', 'interested', 'mb1', 'oldest', ['SDR'],
    ]);
    expect(o.refetchInterval).toBe(15_000);
    expect(INBOX_POLL_MS).toBe(15_000);
  });

  it('fetches with order and role (role omitted when empty)', () => {
    void inboxQueryOptions({ view: 'interested', mailboxId: 'mb1', sort: 'oldest', roles: ['SDR'] }).queryFn();
    expect(api.fetchInbox).toHaveBeenLastCalledWith({ view: 'interested', mailboxId: 'mb1', order: 'oldest', role: ['SDR'] });
    void inboxQueryOptions({ view: 'needs_review' }).queryFn();
    expect(api.fetchInbox).toHaveBeenLastCalledWith({ view: 'needs_review', mailboxId: undefined, order: 'newest', role: undefined });
  });
});

describe('URL parsing', () => {
  it('reads view (legacy ?status=SENT → sent_today) and sort', () => {
    expect(inboxViewFrom(new URLSearchParams('view=interested'))).toBe('interested');
    expect(inboxViewFrom(new URLSearchParams('status=SENT'))).toBe('sent_today');
    expect(inboxViewFrom(new URLSearchParams('view=bogus'))).toBe('needs_review');
    expect(inboxSortFrom(new URLSearchParams('sort=oldest'))).toBe('oldest');
    expect(inboxSortFrom(new URLSearchParams(''))).toBe('newest');
  });
});

describe('waitingCount', () => {
  it('sums the three triage views, ignoring snoozed and sent today', () => {
    expect(waitingCount({ needs_review: 4, interested: 2, not_interested: 1, snoozed: 9, sent_today: 30 })).toBe(7);
  });
  it('is 0 before counts load', () => {
    expect(waitingCount(undefined)).toBe(0);
  });
});
