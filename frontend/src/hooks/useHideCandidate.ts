import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ignoreCandidate, unignoreCandidate } from '../lib/api';
import { extractApiErrorMessage, toastError, toastSuccess } from '../lib/toast';

/**
 * Hide a draftless Needs-review candidate from Inbox and Candidates (the
 * API calls it "ignore"), with an Undo toast. Shared by the pane's button
 * and the D shortcut.
 */
export function useHideCandidate(candidateId: string | undefined, name: string, onDone: () => void) {
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['inbox'] });
    void qc.invalidateQueries({ queryKey: ['candidates'] });
  };
  return useMutation({
    mutationFn: () => ignoreCandidate(candidateId!),
    onSuccess: () => {
      const id = candidateId!;
      toastSuccess(`Hid ${name}`, undefined, {
        label: 'Undo',
        onClick: () => {
          unignoreCandidate(id)
            .then(() => {
              refresh();
              toastSuccess(`Restored ${name}`);
            })
            .catch((err: unknown) => toastError('Could not undo', extractApiErrorMessage(err, 'Please try again.')));
        },
      });
      refresh();
      onDone();
    },
    onError: (err) => toastError('Could not hide', extractApiErrorMessage(err, 'Please try again.')),
  });
}
