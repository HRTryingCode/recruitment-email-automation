import { useEffect, type MutableRefObject, type ReactNode } from 'react';
import { useDraftEditor } from '@/hooks/useDraftEditor';
import { useDraftPresence } from '@/hooks/useDraftPresence';
import type { useInboxActions } from '@/hooks/useInboxActions';
import { useInboxShortcuts } from '@/hooks/useInboxShortcuts';
import { isTypingTarget } from '@/lib/shortcuts';
import type { EmailDraft, InboxItem } from '@/lib/api';
import { focusEditor } from './DraftEditor';
import ReplyPane from './ReplyPane';

interface Props {
  /** The open draft's id (from the URL), so presence starts before it loads. */
  draftId: string;
  item?: InboxItem;
  draft?: EmailDraft;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  actions: ReturnType<typeof useInboxActions>;
  name: string;
  sendable: boolean;
  menus: ReactNode;
  onClose: () => void;
  /** Mirrors "the editor has unsaved changes" for the page's ⌘Z rule, without re-rendering it. */
  dirtyRef: MutableRefObject<boolean>;
}

/**
 * The open reply: owns the editor state (and presence, ⌘↵ / E) so typing
 * re-renders only this subtree, never the page, rail or list.
 */
export default function OpenReply({ draftId, item, draft, loading, error, onRetry, actions, name, sendable, menus, onClose, dirtyRef }: Props) {
  const editor = useDraftEditor(draft);
  const presence = useDraftPresence(draftId, editor.focused || editor.dirty ? 'editing' : 'viewing');
  useEffect(() => {
    dirtyRef.current = editor.dirty;
  }, [dirtyRef, editor.dirty]);
  useEffect(
    () => () => {
      dirtyRef.current = false;
    },
    [dirtyRef]
  );

  const send = () => {
    if (!draft || !sendable || actions.sending) return;
    actions.send(draft, editor.body, name, () => {
      editor.reset(editor.body);
      // Leave the editor so ⌘Z (undo send) and the list keys work right away.
      const el = document.activeElement;
      if (el instanceof HTMLElement && isTypingTarget(el)) el.blur();
    });
  };

  useInboxShortcuts({
    send,
    edit: () => {
      if (sendable && draft) focusEditor(draft.id);
    },
  });

  const undo = actions.rewriteUndo;
  return (
    <ReplyPane
      item={item}
      draft={draft}
      loading={loading}
      error={error}
      onRetry={onRetry}
      editor={editor}
      presence={presence}
      lock={actions.lock}
      onCancelLock={actions.clearLock}
      onClose={onClose}
      onSend={send}
      sending={actions.sending}
      onUndo={() => draft && void actions.undo(draft.id)}
      onUnsnooze={() => draft && void actions.unsnooze(draft.id)}
      onRewrite={(instruction) => draft && actions.rewrite(draft, editor.body, editor.dirty, instruction, editor.reset)}
      onRegenerate={() => draft && actions.regenerate(draft, editor.body, editor.dirty, editor.reset)}
      rewriting={actions.rewriting}
      onUndoRewrite={
        draft && undo?.draftId === draft.id && editor.body === undo.rewritten
          ? () => actions.undoRewrite(draft, undo, editor.reset)
          : undefined
      }
      onChangeCc={(cc) => draft && actions.changeCc(draft, cc)}
      menus={menus}
    />
  );
}
