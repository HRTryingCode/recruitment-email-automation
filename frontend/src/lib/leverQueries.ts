// H5: react-query options for the Add to Lever dialog, shared with the
// hover/focus/row-selection prefetch so both hit the same cache entries.
// Separate from leverApi.ts so tests that mock its fetchers reach these too.
import { queryOptions, type QueryClient } from '@tanstack/react-query';
import {
  fetchLeverGemPrefill,
  fetchLeverPostings,
  fetchLeverPrefill,
  type GemLookupStatus,
  type LeverTarget,
} from './leverApi';

function targetKey(target: LeverTarget): string {
  return 'candidateId' in target ? `c:${target.candidateId}` : `e:${target.email.trim().toLowerCase()}`;
}

/** Gem outcomes worth keeping for 10 min; the rest (not connected, reauth, down) refetch on next open. */
const SETTLED_GEM: ReadonlySet<GemLookupStatus> = new Set(['FOUND', 'NOT_FOUND']);

export function leverPrefillQueryOptions(target: LeverTarget) {
  return queryOptions({
    queryKey: ['lever-prefill', targetKey(target)],
    queryFn: () => fetchLeverPrefill(target),
    staleTime: 60 * 1000,
    retry: false,
  });
}

export function leverGemQueryOptions(target: LeverTarget) {
  return queryOptions({
    queryKey: ['lever-prefill-gem', targetKey(target)],
    queryFn: () => fetchLeverGemPrefill(target),
    staleTime: (q) => (q.state.data && SETTLED_GEM.has(q.state.data.status) ? 10 * 60 * 1000 : 0),
    retry: false,
  });
}

export const leverPostingsQueryOptions = queryOptions({
  queryKey: ['lever-postings'],
  queryFn: () => fetchLeverPostings(),
  staleTime: 10 * 60 * 1000,
  retry: false,
});

/** Warm everything the dialog needs (hover/focus on the button, row selection). */
export function prefetchAddToLever(queryClient: QueryClient, target: LeverTarget): void {
  void queryClient.prefetchQuery(leverPrefillQueryOptions(target));
  void queryClient.prefetchQuery(leverGemQueryOptions(target));
  void queryClient.prefetchQuery(leverPostingsQueryOptions);
}
