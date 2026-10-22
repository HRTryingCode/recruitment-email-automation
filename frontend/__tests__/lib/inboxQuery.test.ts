import { describe, expect, it, vi } from 'vitest';
import * as api from '../../src/lib/api';
import { INBOX_POLL_MS, inboxCounts, inboxQueryOptions, inboxSortFrom, inboxViewFrom, waitingCount } from '../../src/lib/inboxQuery';

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

  // The options are infinite (U1b pages through nextCursor); call queryFn the way React Query does.
  const run = (o: ReturnType<typeof inboxQueryOptions>, pageParam: string | null = null) =>
    (o.queryFn as (ctx: { pageParam: string | null }) => unknown)({ pageParam });

  it('fetches with order and role (role omitted when empty)', () => {
    void run(inboxQueryOptions({ view: 'interested', mailboxId: 'mb1', sort: 'oldest', roles: ['SDR'] }));
    expect(api.fetchInbox).toHaveBeenLastCalledWith({ view: 'interested', mailboxId: 'mb1', order: 'oldest', role: ['SDR'] });
    void run(inboxQueryOptions({ view: 'needs_review' }));
    expect(api.fetchInbox).toHaveBeenLastCalledWith({ view: 'needs_review', mailboxId: undefined, order: 'newest', role: undefined });
  });

  it('pages through nextCursor', () => {
    const o = inboxQueryOptions({ view: 'needs_review' });
    void run(o, 'c2');
    expect(api.fetchInbox).toHaveBeenLastCalledWith({ view: 'needs_review', mailboxId: undefined, order: 'newest', role: undefined, cursor: 'c2' });
    const page = (nextCursor: string | null) => ({ success: true, data: { items: [], counts: {} as never, nextCursor } });
    expect(o.getNextPageParam(page('c3'), [], null, [])).toBe('c3');
    expect(o.getNextPageParam(page(null), [], null, [])).toBeUndefined();
  });
});

describe('inboxCounts', () => {
  it('reads the first page (every page carries the whole view\'s counts)', () => {
    const counts = { needs_review: 1, interested: 2, not_interested: 3, snoozed: 0, sent_today: 0 };
    expect(inboxCounts({ pages: [{ success: true, data: { items: [], counts, nextCursor: null } }], pageParams: [null] })).toBe(counts);
    expect(inboxCounts(undefined)).toBeUndefined();
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
