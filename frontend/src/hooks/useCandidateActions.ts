import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  bulkUpdateCandidates,
  clearRepliedAt,
  generateDraftForThread,
  ignoreCandidate,
  unignoreCandidate,
  updateCandidate,
  type Candidate,
} from '../lib/api';
import { extractApiErrorMessage, toastError, toastSuccess } from '../lib/toast';

/**
 * Every candidate write the Candidates page makes (row menu, side panel,
 * bulk bar). All of them refresh the list, the open candidate and the
 * Inbox, whose queue depends on candidate status.
 */
export function useCandidateActions() {
  const qc = useQueryClient();
  const refresh = (id?: string) => {
    void qc.invalidateQueries({ queryKey: ['candidates'] });
    void qc.invalidateQueries({ queryKey: ['inbox'] });
    if (id) void qc.invalidateQueries({ queryKey: ['candidate', id] });
  };
  const fail = (title: string) => (err: unknown) => toastError(title, extractApiErrorMessage(err, 'Please try again.'));

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: Candidate['status'] }) =>
      // IGNORED must discard live drafts: the ignore flow, not a bare write (M20).
      status === 'IGNORED' ? ignoreCandidate(id) : updateCandidate(id, { status }),
    onSuccess: (_r, { id }) => {
      toastSuccess('Status updated');
      refresh(id);
    },
    onError: fail('Could not update status'),
  });

  const ignore = useMutation({
    mutationFn: (id: string) => ignoreCandidate(id),
    onSuccess: (_r, id) => {
      toastSuccess('Candidate ignored', "We won't generate new drafts and any pending ones were discarded.");
      refresh(id);
    },
    onError: fail('Could not ignore candidate'),
  });

  const restore = useMutation({
    mutationFn: (id: string) => unignoreCandidate(id),
    onSuccess: (_r, id) => {
      toastSuccess('Candidate restored', 'Drafts will be generated for them again.');
      refresh(id);
    },
    onError: fail('Could not restore candidate'),
  });

  // NEEDS_REVIEW triage (M17): the recruiter decides; "interested" also
  // drafts the reply using that decision instead of re-classifying. The
  // status is written first so a draft conflict can't leave it unchanged.
  const triage = useMutation({
    mutationFn: async ({ candidate, decision }: { candidate: Candidate; decision: 'INTERESTED' | 'NOT_INTERESTED' }) => {
      await updateCandidate(candidate.id, { status: decision });
      const threadId = candidate.threads?.[0]?.id;
      if (decision === 'INTERESTED' && threadId) {
        await generateDraftForThread(threadId, 'INTERESTED');
        return { drafted: true };
      }
      return { drafted: false };
    },
    onSuccess: ({ drafted }, { candidate }) => {
      toastSuccess(drafted ? 'Marked interested' : 'Status updated', drafted ? 'A reply is waiting in the Inbox.' : undefined);
      refresh(candidate.id);
    },
    onError: (err, { candidate }) => {
      refresh(candidate.id);
      fail('Triage failed')(err);
    },
  });

  const clearReplied = useMutation({
    mutationFn: (id: string) => clearRepliedAt(id),
    onSuccess: (_r, id) => {
      toastSuccess('Reply status cleared', 'Candidate is now awaiting reply.');
      refresh(id);
    },
    onError: fail('Could not clear reply status'),
  });

  const bulk = useMutation({
    mutationFn: ({ ids, status }: { ids: string[]; status: Candidate['status'] }) => bulkUpdateCandidates(ids, status),
    onSuccess: (res, { status }) => {
      const n = res.data.updated;
      const who = `${n} candidate${n === 1 ? '' : 's'}`;
      toastSuccess(status === 'IGNORED' ? `Ignored ${who}` : `Updated ${who}`);
      refresh();
    },
    onError: fail('Bulk update failed'),
  });

  return { setStatus, ignore, restore, triage, clearReplied, bulk };
}
