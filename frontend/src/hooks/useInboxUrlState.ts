import { useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { InboxView } from '../lib/api';
import { isInboxView } from '../lib/inbox';

/**
 * Inbox place in the URL — /inbox?view=…&mailbox=…&item=<draftId> — so a
 * refresh or a shared link reopens the same reply. Legacy ?draftId= links
 * (old Drafts tab, Slack alerts) are rewritten to ?item=.
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
  const view: InboxView = isInboxView(rawView) ? rawView : 'needs_review';
  const mailboxId = params.get('mailbox') ?? undefined;
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

  const setView = useCallback((v: InboxView) => update({ view: v, item: undefined }), [update]);
  const setMailbox = useCallback((id?: string) => update({ mailbox: id, item: undefined }), [update]);
  const setItem = useCallback((id?: string) => update({ item: id }, true), [update]);

  return { view, mailboxId, itemId, setView, setMailbox, setItem };
}
