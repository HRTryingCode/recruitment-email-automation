import { fetchInbox, type InboxView } from './api';
import { isInboxView, type InboxSort } from './inbox';

export const INBOX_POLL_MS = 15_000;

/**
 * The inbox queue query, shared by the Inbox page and the shell's nav
 * badge so both read one cache entry (same key, same cadence) instead of
 * polling separately. The ['inbox', view, …] prefix stays first: mutations
 * invalidate ['inbox'].
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
  return {
    queryKey: ['inbox', view, mailboxId ?? null, sort, roles] as const,
    queryFn: () => fetchInbox({ view, mailboxId, order: sort, role: roles.length ? roles : undefined }),
    refetchInterval: INBOX_POLL_MS,
  };
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
