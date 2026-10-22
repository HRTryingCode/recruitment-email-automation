import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * All view state lives in the URL (R1). `mailboxId` is global to the shell
 * and survives switching views; everything in VIEW_PARAMS belongs to one
 * view and is dropped when you navigate to another (the old tab layout
 * never cleared `filter` / `q`, so they leaked across tabs).
 */
export const GLOBAL_PARAMS = ['mailboxId'] as const;

export const VIEW_PARAMS = [
  'filter',
  'q',
  'lever',
  'sort',
  'dir',
  'page',
  'status',
  'view',
  'draftId',
  'candidateId',
  'reply',
  'candidate',
] as const;

/** Href for another view: global params carried over, view params dropped. */
export function viewHref(
  path: string,
  current: URLSearchParams,
  extra: Record<string, string | null | undefined> = {}
): string {
  const next = new URLSearchParams();
  for (const key of GLOBAL_PARAMS) {
    const v = current.get(key);
    if (v) next.set(key, v);
  }
  for (const [key, v] of Object.entries(extra)) {
    if (v) next.set(key, v);
  }
  const qs = next.toString();
  return qs ? `${path}?${qs}` : path;
}

/**
 * One search param as state. Setting the fallback (or '') removes the param
 * so URLs stay short; updates replace the history entry.
 */
export function useUrlParam(key: string, fallback = ''): [string, (value: string | null) => void] {
  const [params, setParams] = useSearchParams();
  const value = params.get(key) ?? fallback;
  const set = useCallback(
    (next: string | null) => {
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          if (next === null || next === '' || next === fallback) p.delete(key);
          else p.set(key, next);
          return p;
        },
        { replace: true }
      );
    },
    [key, fallback, setParams]
  );
  return [value, set];
}

/** The shell-wide mailbox filter (`?mailboxId=`); undefined = all mailboxes. */
export function useMailboxFilter(): [string | undefined, (id: string | undefined) => void] {
  const [value, set] = useUrlParam('mailboxId');
  const setId = useCallback((id: string | undefined) => set(id ?? null), [set]);
  return [value || undefined, setId];
}
