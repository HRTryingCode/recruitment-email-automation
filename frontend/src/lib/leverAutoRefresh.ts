// H1: never-checked candidates get their Lever status on first render instead
// of waiting for the lever-sync cron. Each candidate is refreshed at most once
// per page session (success or failure — no retry storms) through a shared
// queue capped at 5 concurrent POST /api/candidates/:id/lever/refresh calls.
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { refreshCandidateLever, type Candidate, type LeverCandidateFields } from './api';

const MAX_CONCURRENT = 5;

type Refresh = (id: string) => Promise<Candidate | null>;
type OnDone = (candidate: Candidate) => void;

export function createLeverRefreshQueue(refresh: Refresh, opts: { concurrency?: number } = {}) {
  const concurrency = opts.concurrency ?? MAX_CONCURRENT;
  const seen = new Set<string>();
  const pending: Array<{ id: string; onDone: OnDone }> = [];
  let active = 0;

  function pump(): void {
    while (active < concurrency && pending.length > 0) {
      const job = pending.shift()!;
      active += 1;
      Promise.resolve()
        .then(() => refresh(job.id))
        .then((c) => {
          if (c) job.onDone(c);
        })
        .catch(() => {
          // Leave the row on "Checking Lever…"; the 15-min cron picks it up.
        })
        .finally(() => {
          active -= 1;
          pump();
        });
    }
  }

  return {
    /** Returns false when the candidate was already requested this session. */
    enqueue(id: string, onDone: OnDone): boolean {
      if (seen.has(id)) return false;
      seen.add(id);
      pending.push({ id, onDone });
      pump();
      return true;
    },
  };
}

let queue: ReturnType<typeof createLeverRefreshQueue> | null = null;

function sessionQueue() {
  queue ??= createLeverRefreshQueue(async (id) => (await refreshCandidateLever(id)).data.candidate);
  return queue;
}

export function resetLeverAutoRefreshForTests(): void {
  queue = null;
}

const LEVER_KEYS: Array<keyof LeverCandidateFields> = [
  'leverState',
  'leverOpportunityId',
  'leverPostingTitle',
  'leverStage',
  'leverArchivedReason',
  'leverCheckedAt',
  'leverError',
];

type CandidatePage = { data: Candidate[] } | undefined;

/** Kicks off a Lever check for every never-checked row and patches the result into cached candidate lists. */
export function useLeverAutoRefresh(candidates: Candidate[]): void {
  const queryClient = useQueryClient();
  const neverChecked = candidates
    .filter((c) => !c.leverState && !c.leverCheckedAt)
    .map((c) => c.id)
    .join(',');

  useEffect(() => {
    if (!neverChecked) return;
    const onDone = (updated: Candidate) => {
      const patch: LeverCandidateFields = {};
      for (const k of LEVER_KEYS) (patch as Record<string, unknown>)[k] = updated[k] ?? null;
      queryClient.setQueriesData<CandidatePage>({ queryKey: ['candidates'] }, (old) =>
        old && Array.isArray(old.data)
          ? { ...old, data: old.data.map((c) => (c.id === updated.id ? { ...c, ...patch } : c)) }
          : old
      );
    };
    for (const id of neverChecked.split(',')) sessionQueue().enqueue(id, onDone);
  }, [neverChecked, queryClient]);
}
