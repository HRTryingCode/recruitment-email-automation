import { useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { InboxView } from '../lib/api';
import { isInboxView } from '../lib/inbox';

/**
 * Inbox place in the URL — /inbox?view=…&mailboxId=…&item=<draftId> — so a
 * refresh or a shared link reopens the same reply. `mailboxId` is the
 * shell-wide filter (R1); `mailbox` is reserved for the Gmail OAuth
 * callback. Legacy links: ?draftId= is rewritten to ?item=; ?candidateId=
 * is exposed for the page to resolve (it needs the list); ?status=SENT
 * (old Drafts tab) opens Sent today.
 */
export function useInboxUrlState() {
  const [params, setParams] = useSearchParams();
  const legacyDraftId = params.get('draftId');

  useEffect(() => {
    if (!legacyDraftId) return;
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('draftId');
        if (!next.get('item')) next.set('item', legacyDraftId);
        return next;
      },
      { replace: true }
    );
  }, [legacyDraftId, setParams]);

  const rawView = params.get('view');
  const view: InboxView = isInboxView(rawView) ? rawView : params.get('status') === 'SENT' ? 'sent_today' : 'needs_review';
  const mailboxId = params.get('mailboxId') ?? undefined;
  const legacyCandidateId = params.get('candidateId') ?? undefined;
  const itemId = params.get('item') ?? legacyDraftId ?? undefined;

  const update = useCallback(
    (patch: Record<string, string | undefined>, replace = false) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch)) {
            if (v) next.set(k, v);
            else next.delete(k);
          }
          return next;
        },
        { replace }
      );
    },
    [setParams]
  );

  const setView = useCallback((v: InboxView) => update({ view: v, item: undefined, status: undefined }), [update]);
  const setMailbox = useCallback((id?: string) => update({ mailboxId: id, item: undefined }), [update]);
  const setItem = useCallback((id?: string) => update({ item: id }, true), [update]);
  /** View and item together (H8: a triage draft lands in another view). */
  const setPlace = useCallback(
    (v: InboxView, id?: string) => update({ view: v, item: id, status: undefined }, true),
    [update]
  );
  /** Replace a legacy ?candidateId= with the item it resolved to (or nothing). */
  const resolveCandidate = useCallback((key?: string) => update({ candidateId: undefined, item: key }, true), [update]);

  return { view, mailboxId, itemId, legacyCandidateId, setView, setMailbox, setItem, setPlace, resolveCandidate };
}
