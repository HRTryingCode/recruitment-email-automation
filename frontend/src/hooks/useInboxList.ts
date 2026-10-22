import { useEffect, useMemo } from 'react';
import { useInfiniteQuery, type InfiniteData } from '@tanstack/react-query';
import { fetchInbox, type InboxItem, type InboxPage, type InboxView, type SingleResponse } from '../lib/api';
import { mergePages, type InboxSort } from '../lib/inbox';

export const INBOX_POLL_MS = 15_000;

/** Group by role pulls in the whole view, up to this many pages (50 each). */
export const MAX_GROUPED_PAGES = 10;

/** The infinite inbox cache entry under ['inbox', view, …]. */
export type InboxCache = InfiniteData<SingleResponse<InboxPage>, string | null>;

interface Params {
  view: InboxView;
  mailboxId?: string;
  sort: InboxSort;
  roles: string[];
  /** Grouping needs every page: section membership spans the whole view. */
  grouped: boolean;
}

/**
 * One inbox view, paged through nextCursor. Polling refetches every loaded
 * page; mergePages drops an item that slid across a page boundary meanwhile.
 * Counts and roleCounts are the whole view's and come from the first page.
 */
export function useInboxList({ view, mailboxId, sort, roles, grouped }: Params) {
  const q = useInfiniteQuery({
    // ['inbox', view, …] prefix stays first: mutations invalidate ['inbox'].
    queryKey: ['inbox', view, mailboxId ?? null, sort, roles],
    queryFn: ({ pageParam }) =>
      fetchInbox({
        view,
        mailboxId,
        order: sort,
        role: roles.length ? roles : undefined,
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.data.nextCursor ?? undefined,
    refetchInterval: INBOX_POLL_MS,
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[1] === view ? prev : undefined),
  });

  const pages = q.data?.pages;
  const items = useMemo<InboxItem[]>(() => mergePages((pages ?? []).map((p) => p.data.items)), [pages]);
  const first = pages?.[0]?.data;
  const roleCounts = useMemo(() => first?.roleCounts ?? [], [first]);

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = q;
  const loadedPages = pages?.length ?? 0;
  useEffect(() => {
    if (grouped && hasNextPage && !isFetchingNextPage && loadedPages < MAX_GROUPED_PAGES) void fetchNextPage();
  }, [grouped, hasNextPage, isFetchingNextPage, loadedPages, fetchNextPage]);

  return {
    items,
    counts: first?.counts,
    roleCounts,
    ready: !!q.data,
    isLoading: q.isLoading,
    isError: q.isError,
    refetch: q.refetch,
    hasNextPage: !!hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  };
}
