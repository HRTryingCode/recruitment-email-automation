import { useCallback, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { filtersFromParams, filtersToParams, type CandidateFilters } from '../lib/candidates';

/**
 * Candidates place in the URL (R3):
 * /candidates?status=&reply=&lever=&q=&sort=&dir=&page=&view=&candidate=
 * plus the shell's mailboxId. Legacy `?filter=` pills (Today) are rewritten
 * to status/reply once, so the chips and the URL agree.
 */
export function useCandidateUrlState() {
  const [params, setParams] = useSearchParams();
  const legacy = params.get('filter');

  useEffect(() => {
    if (!legacy) return;
    setParams((prev) => filtersToParams(prev, filtersFromParams(prev)), { replace: true });
  }, [legacy, setParams]);

  const key = params.toString();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` is the params' identity.
  const filters = useMemo(() => filtersFromParams(params), [key]);
  const page = Math.max(1, Number(params.get('page')) || 1);
  const viewId = params.get('view') ?? undefined;
  const selectedId = params.get('candidate') ?? undefined;
  const mailboxId = params.get('mailboxId') ?? undefined;

  /**
   * New filters reset the page. `view` names the saved view they came from;
   * leaving it out keeps the current one (so it can be updated after an edit).
   */
  const setFilters = useCallback(
    (next: CandidateFilters, view?: string) => {
      setParams(
        (prev) => {
          const p = filtersToParams(prev, next);
          if (view) p.set('view', view);
          return p;
        },
        { replace: true }
      );
    },
    [setParams]
  );

  const patch = useCallback(
    (entries: Record<string, string | undefined>, replace = true) => {
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(entries)) {
            if (v) p.set(k, v);
            else p.delete(k);
          }
          return p;
        },
        { replace }
      );
    },
    [setParams]
  );

  const setPage = useCallback((n: number) => patch({ page: n > 1 ? String(n) : undefined }), [patch]);
  /** Opening a candidate is a history entry, so Back closes the panel. */
  const setSelected = useCallback((id?: string) => patch({ candidate: id }, !id), [patch]);

  return { filters, page, viewId, selectedId, mailboxId, setFilters, setPage, setSelected };
}
