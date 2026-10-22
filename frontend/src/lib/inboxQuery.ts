import { infiniteQueryOptions, type InfiniteData } from '@tanstack/react-query';
import { fetchInbox, type InboxPage, type InboxView, type SingleResponse } from './api';
import { isInboxView, type InboxSort } from './inbox';

export const INBOX_POLL_MS = 15_000;

/**
 * The inbox queue query, shared by the Inbox page and the shell's nav
 * badge so both read one cache entry (same key, same cadence) instead of
 * polling separately. It is an infinite query paged through nextCursor
 * (U1b): the badge reads the first page's counts, the page every loaded
 * page. The ['inbox', view, …] prefix stays first: mutations invalidate
 * ['inbox'].
 */
export function inboxQueryOptions({
  view,
  mailboxId,
  sort = 'newest',
  roles = [],
}: {
  view: InboxView;
  mailboxId?: string;
  sort?: InboxSort;
  roles?: string[];
}) {
  return infiniteQueryOptions({
    queryKey: ['inbox', view, mailboxId ?? null, sort, roles] as const,
    queryFn: ({ pageParam }: { pageParam: string | null }) =>
      fetchInbox({
        view,
        mailboxId,
        order: sort,
        role: roles.length ? roles : undefined,
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last: SingleResponse<InboxPage>) => last.data.nextCursor ?? undefined,
    refetchInterval: INBOX_POLL_MS,
  });
}

/** The whole view's counts: every page carries them, the first is enough. */
export function inboxCounts(data: InfiniteData<SingleResponse<InboxPage>, unknown> | undefined) {
  return data?.pages[0]?.data.counts;
}

/** Replies waiting on a human: the three triage views (matches the rail). */
export function waitingCount(counts: Partial<Record<InboxView, number>> | undefined): number {
  if (!counts) return 0;
  return (counts.needs_review ?? 0) + (counts.interested ?? 0) + (counts.not_interested ?? 0);
}

/** The Inbox view a URL selects; legacy ?status=SENT (old Drafts tab) opens Sent today. */
export function inboxViewFrom(params: URLSearchParams): InboxView {
  const raw = params.get('view');
  return isInboxView(raw) ? raw : params.get('status') === 'SENT' ? 'sent_today' : 'needs_review';
}

/** ?sort=oldest, else newest first. */
export function inboxSortFrom(params: URLSearchParams): InboxSort {
  return params.get('sort') === 'oldest' ? 'oldest' : 'newest';
}
