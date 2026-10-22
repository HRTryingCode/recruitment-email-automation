import { useCallback, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { generateDraftForThread, type EmailDraft, type InboxItem, type InboxView } from '../lib/api';
import type { InboxCache } from './useInboxList';
import { VIEWS, viewForClass, type TriageClass } from '../lib/inbox';
import { extractApiErrorMessage, toastSuccess } from '../lib/toast';

export interface TriageResult {
  /** Inbox key of the candidate row the draft was written from. */
  key: string;
  candidateId: string;
  draft: EmailDraft;
  view: 'interested' | 'not_interested';
  name: string;
  mailbox: string;
}

type Job = { classification: TriageClass; threadId: string; item: InboxItem; error?: string };

interface Options {
  /** The item open right now; decides between swapping in place and only toasting. */
  currentKey: () => string | undefined;
  onDrafted: (result: TriageResult, inPlace: boolean) => void;
  /** The toast's Open action. */
  onOpen: (result: TriageResult) => void;
}

/**
 * Writes a draft for a Needs-review candidate (H8). Lives on the page, not
 * the pane, so a reply still lands — with a toast — when the recruiter has
 * moved on to another item while it was being written.
 */
export function useTriageDraft({ currentKey, onDrafted, onOpen }: Options) {
  const qc = useQueryClient();
  const [jobs, setJobs] = useState<Record<string, Job>>({});
  // Synchronous guard: a double click fires twice before the re-render disables the button.
  const inFlight = useRef(new Set<string>());
  const latest = useRef({ currentKey, onDrafted, onOpen });
  latest.current = { currentKey, onDrafted, onOpen };

  const run = useCallback(
    async (key: string, job: Job) => {
      if (inFlight.current.has(key)) return;
      inFlight.current.add(key);
      setJobs((j) => ({ ...j, [key]: { ...job, error: undefined } }));
      try {
        const res = await generateDraftForThread(job.threadId, job.classification);
        const view = viewForClass(job.classification);
        const candidateId = job.item.candidate?.id ?? job.item.id;
        const result: TriageResult = {
          key,
          candidateId,
          draft: res.data,
          view,
          name: job.item.candidate?.name ?? 'Unknown candidate',
          mailbox: job.item.mailbox?.emailAddress ?? '',
        };
        moveInCache(qc, job.item, view);
        void qc.invalidateQueries({ queryKey: ['inbox'] });
        void qc.invalidateQueries({ queryKey: ['candidate', candidateId] });
        // Triage also set the candidate's status server-side (R3).
        void qc.invalidateQueries({ queryKey: ['candidates'] });
        setJobs(({ [key]: _done, ...rest }) => rest);
        const label = VIEWS.find((v) => v.id === view)!.label;
        toastSuccess(`Draft created for ${result.name} in ${label}`, undefined, {
          label: 'Open',
          onClick: () => latest.current.onOpen(result),
        });
        latest.current.onDrafted(result, latest.current.currentKey() === key);
      } catch (err) {
        setJobs((j) => ({ ...j, [key]: { ...job, error: extractApiErrorMessage(err, 'Please try again.') } }));
      } finally {
        inFlight.current.delete(key);
      }
    },
    [qc]
  );

  const start = useCallback(
    (key: string, item: InboxItem, threadId: string, classification: TriageClass) =>
      void run(key, { classification, threadId, item }),
    [run]
  );
  const retry = useCallback(
    (key: string) => {
      const job = jobs[key];
      if (job) void run(key, job);
    },
    [jobs, run]
  );

  return {
    start,
    retry,
    pendingFor: (key: string): TriageClass | null => (jobs[key] && !jobs[key].error ? jobs[key].classification : null),
    errorFor: (key: string): string | null => jobs[key]?.error ?? null,
  };
}

/** Optimistic move: drop the candidate row and shift one count from Needs review to `view`. */
function moveInCache(qc: ReturnType<typeof useQueryClient>, item: InboxItem, view: InboxView) {
  qc.setQueriesData<InboxCache>({ queryKey: ['inbox'] }, (old) => {
    if (!old?.pages?.length) return old;
    const isRow = (i: InboxItem) => i.kind === 'candidate' && i.id === item.id;
    if (!old.pages.some((p) => p.data.items.some(isRow))) return old;
    return {
      ...old,
      pages: old.pages.map((p) => ({
        ...p,
        data: {
          ...p.data,
          items: p.data.items.filter((i) => !isRow(i)),
          counts: { ...p.data.counts, needs_review: Math.max(0, p.data.counts.needs_review - 1), [view]: p.data.counts[view] + 1 },
        },
      })),
    };
  });
}
