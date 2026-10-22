import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import {
  batchSendDrafts,
  dictateDraft,
  dismissDraft,
  regenerateDraft,
  scheduleSendDraft,
  undismissDraft,
  snoozeDraft,
  undoSendDraft,
  unsnoozeDraft,
  updateDraft,
  type BatchSendResult,
  type DismissReason,
  type EmailDraft,
} from '../lib/api';
import { liveSummary, nextItemId } from '../lib/inbox';
import { extractApiErrorMessage, toastError, toastSuccess, toastWarning } from '../lib/toast';
import { dismissUndoToast, showUndoToast } from '../components/inbox/undoToast';
import type { LockState } from '../components/inbox/ReplyPane';

export const UNDO_SECONDS = 10;

/** `lockedBy` of a 423 (someone else is editing), else null. */
export function lockedBy(err: unknown): string | null {
  if (!axios.isAxiosError(err) || err.response?.status !== 423) return null;
  const data = err.response.data as { lockedBy?: string } | undefined;
  return data?.lockedBy ?? 'Someone';
}

export interface RewriteUndo {
  draftId: string;
  /** The body before the rewrite (edits included). */
  previous: string;
  /** What the rewrite produced; the undo is offered while the editor still shows it. */
  rewritten: string;
}

interface Options {
  /** Keys of the items in the open view, in list order. */
  keys: string[];
  setItem: (key?: string) => void;
  /** Our own action is about to put replies back (undo / restore): not "new replies". */
  onLocalChange?: () => void;
  /** Replies just scheduled to send (watched until they go out or fail). */
  onSent?: (sends: Array<{ id: string; name: string }>) => void;
  /** Candidate name for an item key (batch sends, announcements). */
  nameOf?: (key: string) => string | undefined;
  /** Polite live-region text after an action ("Sent to Ana. Opened Ben."). */
  announce?: (text: string) => void;
}

/**
 * Every inbox decision: one-step send + undo, dismiss, snooze, rewrites.
 * Each ends by auto-advancing to the next reply; a 423 stops and surfaces
 * a blocking LockState whose retry replays the action with override.
 */
export function useInboxActions({ keys, setItem, onLocalChange, onSent, nameOf, announce }: Options) {
  const qc = useQueryClient();
  const [lock, setLock] = useState<LockState | null>(null);
  const [busy, setBusy] = useState<'send' | 'rewrite' | null>(null);
  /** The last rewrite/regenerate that replaced the body, until undone or edited over. */
  const [rewriteUndo, setRewriteUndo] = useState<RewriteUndo | null>(null);
  const lastSend = useRef<{ id: string; name: string; until: number; toastId: string | number } | null>(null);
  const keysRef = useRef(keys);
  const cbs = useRef({ onLocalChange, onSent, nameOf, announce });
  useLayoutEffect(() => {
    keysRef.current = keys;
    cbs.current = { onLocalChange, onSent, nameOf, announce };
  });
  const localChange = useCallback(() => cbs.current.onLocalChange?.(), []);

  const refreshInbox = useCallback(() => qc.invalidateQueries({ queryKey: ['inbox'] }), [qc]);
  /** Open the reply after `key` and announce `done` plus what opened. */
  const advanceFrom = useCallback(
    (key: string, done: string) => {
      const next = nextItemId(keysRef.current, key) ?? undefined;
      setItem(next);
      cbs.current.announce?.(liveSummary(done, next ? cbs.current.nameOf?.(next) : undefined));
    },
    [setItem]
  );
  const nameFor = (key: string) => cbs.current.nameOf?.(key) ?? 'the candidate';

  /** Run `fn(override)`; on 423 show the lock with `label` as the override button. */
  const guarded = useCallback(
    async <T,>(label: string, failTitle: string, fn: (override: boolean) => Promise<T>, override = false): Promise<T | undefined> => {
      try {
        const out = await fn(override);
        setLock(null);
        return out;
      } catch (err) {
        const holder = lockedBy(err);
        if (holder && !override) {
          setLock({
            name: holder,
            actionLabel: label,
            retry: () => {
              setLock(null);
              void guarded(label, failTitle, fn, true);
            },
          });
          return undefined;
        }
        toastError(failTitle, extractApiErrorMessage(err, 'Please try again.'));
        return undefined;
      }
    },
    []
  );

  const undo = useCallback(
    async (id: string) => {
      try {
        await undoSendDraft(id);
        localChange();
        if (lastSend.current?.id === id) {
          dismissUndoToast(lastSend.current.toastId);
          lastSend.current = null;
        }
        toastSuccess('Send cancelled', 'The reply is back in your inbox.');
        await refreshInbox();
        setItem(id);
      } catch (err) {
        const status = axios.isAxiosError(err) ? err.response?.status : undefined;
        if (status === 409) toastError('Already sent', 'The undo window has passed.');
        else toastError('Could not undo', extractApiErrorMessage(err, 'Please try again.'));
      }
    },
    [refreshInbox, setItem, localChange]
  );

  const send = useCallback(
    (draft: EmailDraft, body: string, name: string, onSent?: () => void) => {
      setBusy('send');
      void guarded('Send anyway', 'Could not send', async (override) => {
        await scheduleSendDraft(draft.id, {
          undoSeconds: UNDO_SECONDS,
          ...(body !== draft.bodyText ? { bodyText: body } : {}),
          ...(override ? { override: true } : {}),
        });
        onSent?.();
        cbs.current.onSent?.([{ id: draft.id, name }]);
        const toastId = showUndoToast({ title: `Sending to ${name}`, seconds: UNDO_SECONDS, onUndo: () => void undo(draft.id) });
        lastSend.current = { id: draft.id, name, until: Date.now() + UNDO_SECONDS * 1000, toastId };
        advanceFrom(draft.id, `Sent to ${name}`);
        void refreshInbox();
      }).finally(() => setBusy(null));
    },
    [guarded, undo, advanceFrom, refreshInbox]
  );

  /** ⌘Z: undo the last send while its window is open. */
  const canUndoLast = useCallback(() => {
    const last = lastSend.current;
    return !!last && Date.now() < last.until;
  }, []);
  const undoLast = useCallback(() => {
    if (canUndoLast()) void undo(lastSend.current!.id);
  }, [undo, canUndoLast]);

  /** Undo for Dismiss: back to PENDING and reopened. */
  const undismiss = useCallback(
    async (draftId: string) => {
      try {
        await undismissDraft(draftId);
        localChange();
        toastSuccess('Back in the inbox');
        await refreshInbox();
        void qc.invalidateQueries({ queryKey: ['draft', draftId] });
        setItem(draftId);
      } catch (err) {
        toastError('Could not restore the reply', extractApiErrorMessage(err, 'Please try again.'));
      }
    },
    [qc, refreshInbox, setItem, localChange]
  );

  const dismiss = useCallback(
    (key: string, draftId: string, reason: DismissReason) => {
      void guarded('Dismiss anyway', 'Could not dismiss', async (override) => {
        await dismissDraft(draftId, { reason, ...(override ? { override: true } : {}) });
        toastSuccess('Dismissed', 'No reply will be sent.', { label: 'Undo', onClick: () => void undismiss(draftId) });
        advanceFrom(key, `Dismissed ${nameFor(key)}`);
        void refreshInbox();
      });
    },
    [guarded, advanceFrom, refreshInbox, undismiss]
  );

  const unsnooze = useCallback(
    async (draftId: string) => {
      try {
        await unsnoozeDraft(draftId);
        localChange();
        toastSuccess('Back in the inbox');
        void refreshInbox();
        void qc.invalidateQueries({ queryKey: ['draft', draftId] });
      } catch (err) {
        toastError('Could not unsnooze', extractApiErrorMessage(err, 'Please try again.'));
      }
    },
    [qc, refreshInbox, localChange]
  );

  const snooze = useCallback(
    async (key: string, draftId: string, until: Date) => {
      try {
        await snoozeDraft(draftId, until.toISOString());
        const when = until.toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' });
        toastSuccess(`Snoozed until ${when}`, undefined, { label: 'Undo', onClick: () => void unsnooze(draftId) });
        advanceFrom(key, `Snoozed ${nameFor(key)}`);
        void refreshInbox();
      } catch (err) {
        toastError('Could not snooze', extractApiErrorMessage(err, 'Please try again.'));
      }
    },
    [advanceFrom, refreshInbox, unsnooze]
  );

  /** Merge a draft returned by PATCH/dictate/regenerate into the open draft's cache. */
  const mergeDraft = useCallback(
    (updated: EmailDraft) => {
      qc.setQueryData<{ success: boolean; data: EmailDraft }>(['draft', updated.id], (old) =>
        old
          ? {
              ...old,
              data: {
                ...old.data,
                ...updated,
                originalMessage: old.data.originalMessage,
                thread: old.data.thread ? { ...old.data.thread, ...(updated.thread ?? {}), messages: old.data.thread.messages } : updated.thread,
              },
            }
          : old
      );
    },
    [qc]
  );

  /** Save unsaved edits (so a rewrite or regenerate keeps them). */
  const saveIfDirty = useCallback(
    async (draft: EmailDraft, body: string, dirty: boolean, override: boolean) => {
      if (!dirty) return;
      const res = await updateDraft(draft.id, { bodyText: body, ...(override ? { override: true } : {}) });
      mergeDraft(res.data);
    },
    [mergeDraft]
  );

  const undoRewrite = useCallback(
    (draft: EmailDraft, undo: RewriteUndo, adopt: (body: string) => void) => {
      void guarded('Restore anyway', 'Could not undo the rewrite', async (override) => {
        const res = await updateDraft(draft.id, { bodyText: undo.previous, ...(override ? { override: true } : {}) });
        mergeDraft(res.data);
        adopt(undo.previous);
        setRewriteUndo((cur) => (cur === undo ? null : cur));
      });
    },
    [guarded, mergeDraft]
  );

  /** Adopt a rewritten body, keeping the old one for "Undo rewrite". */
  const adoptRewrite = useCallback(
    (draft: EmailDraft, previous: string, rewritten: string, adopt: (body: string) => void) => {
      adopt(rewritten);
      if (previous === rewritten) return;
      const undo = { draftId: draft.id, previous, rewritten };
      setRewriteUndo(undo);
      toastSuccess('Rewritten', undefined, { label: 'Undo rewrite', onClick: () => undoRewrite(draft, undo, adopt) });
    },
    [undoRewrite]
  );

  const rewrite = useCallback(
    (draft: EmailDraft, body: string, dirty: boolean, instruction: string, adopt: (body: string) => void) => {
      setBusy('rewrite');
      void guarded('Rewrite anyway', 'Could not rewrite', async (override) => {
        await saveIfDirty(draft, body, dirty, override);
        const res = await dictateDraft(draft.id, instruction, override ? { override: true } : {});
        mergeDraft(res.data);
        adoptRewrite(draft, body, res.data.bodyText, adopt);
      }).finally(() => setBusy(null));
    },
    [guarded, saveIfDirty, mergeDraft, adoptRewrite]
  );

  const regenerate = useCallback(
    (draft: EmailDraft, body: string, dirty: boolean, adopt: (body: string) => void) => {
      setBusy('rewrite');
      void guarded('Regenerate anyway', 'Could not regenerate', async (override) => {
        await saveIfDirty(draft, body, dirty, override);
        const res = await regenerateDraft(draft.id, { keepEdits: true, ...(override ? { override: true } : {}) });
        mergeDraft(res.data);
        if (res.data.keptEdits) toastSuccess('New AI draft ready', 'Your edits were kept — use Show changes to compare.');
        else adoptRewrite(draft, body, res.data.bodyText, adopt);
      }).finally(() => setBusy(null));
    },
    [guarded, saveIfDirty, mergeDraft, adoptRewrite]
  );

  const changeCc = useCallback(
    (draft: EmailDraft, ccEmail: string | null) => {
      void guarded('Change anyway', 'Could not change the CC', async (override) => {
        const res = await updateDraft(draft.id, { ccEmail, ...(override ? { override: true } : {}) });
        mergeDraft(res.data);
        const change = res.ccChange;
        toastSuccess(change?.firstName ? `CC changed to ${change.firstName}` : 'CC removed');
        if (change?.loopIn === 'not_found') toastWarning("Update the name in the email body — we couldn't do it automatically");
        if (change?.handoffWithoutCc) toastWarning("No one is CC'd, but the email still says you're looping someone in", 'Pick a CC or edit the body.');
      });
    },
    [guarded, mergeDraft]
  );

  /** Batch one-step send (Not interested); Undo cancels every scheduled reply. */
  const batchSend = useCallback(
    async (draftIds: string[]): Promise<BatchSendResult | undefined> => {
      try {
        const res = await batchSendDrafts(draftIds, UNDO_SECONDS);
        const { scheduled } = res.data;
        cbs.current.onSent?.(scheduled.map((id) => ({ id, name: cbs.current.nameOf?.(id) ?? 'a candidate' })));
        if (scheduled.length > 0) {
          showUndoToast({
            title: `Sending ${scheduled.length} ${scheduled.length === 1 ? 'reply' : 'replies'}`,
            seconds: UNDO_SECONDS,
            onUndo: () => {
              void Promise.allSettled(scheduled.map((id) => undoSendDraft(id))).then((results) => {
                localChange();
                const failed = results.filter((r) => r.status === 'rejected').length;
                if (failed) toastError(`${failed} already sent`, 'The undo window had passed for those.');
                else toastSuccess('Sends cancelled', 'The replies are back in your inbox.');
                void refreshInbox();
              });
            },
          });
        }
        void refreshInbox();
        return res.data;
      } catch (err) {
        toastError('Could not send the replies', extractApiErrorMessage(err, 'Please try again.'));
        return undefined;
      }
    },
    [refreshInbox, localChange]
  );

  return {
    lock,
    clearLock: () => setLock(null),
    sending: busy === 'send',
    rewriting: busy === 'rewrite',
    send,
    undo,
    undoLast,
    canUndoLast,
    dismiss,
    undismiss,
    snooze,
    unsnooze,
    rewrite,
    regenerate,
    rewriteUndo,
    undoRewrite,
    changeCc,
    batchSend,
  };
}
