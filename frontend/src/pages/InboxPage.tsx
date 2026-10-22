import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MousePointerClick } from 'lucide-react';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Kbd } from '@/components/ui/kbd';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import BatchSendDialog from '@/components/inbox/BatchSendDialog';
import CandidatePane from '@/components/inbox/CandidatePane';
import DismissMenu from '@/components/inbox/DismissMenu';
import { focusEditor } from '@/components/inbox/DraftEditor';
import InboxCommandPalette from '@/components/inbox/InboxCommandPalette';
import InboxList, { itemKey } from '@/components/inbox/InboxList';
import InboxRail, { MailboxSelect } from '@/components/inbox/InboxRail';
import ReplyPane, { isSendable } from '@/components/inbox/ReplyPane';
import ShortcutHelpDialog from '@/components/inbox/ShortcutHelpDialog';
import SnoozeMenu from '@/components/inbox/SnoozeMenu';
import { useDraftEditor } from '@/hooks/useDraftEditor';
import { useDraftPresence } from '@/hooks/useDraftPresence';
import { useInboxActions } from '@/hooks/useInboxActions';
import { useInboxShortcuts } from '@/hooks/useInboxShortcuts';
import { useInboxUrlState } from '@/hooks/useInboxUrlState';
import { fetchDraft, fetchInbox, type InboxView } from '@/lib/api';
import { VIEWS, isInboxView } from '@/lib/inbox';
import { cn } from '@/lib/utils';

export const INBOX_POLL_MS = 15_000;

function isTyping(el: Element | null): el is HTMLElement {
  return el instanceof HTMLElement && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
}

/**
 * The R2 Inbox: one keyboard-first queue replacing the Drafts tab and the
 * dashboard's Quick triage. Every reply ends in Send (with undo), Dismiss
 * or Snooze, and the next one opens automatically.
 */
export default function InboxPage() {
  const { view, mailboxId, itemId, setView, setMailbox, setItem } = useInboxUrlState();
  const inboxQ = useQuery({
    queryKey: ['inbox', view, mailboxId ?? null],
    queryFn: () => fetchInbox({ view, mailboxId }),
    refetchInterval: INBOX_POLL_MS,
  });
  const items = useMemo(() => inboxQ.data?.data.items ?? [], [inboxQ.data]);
  const keys = useMemo(() => items.map(itemKey), [items]);
  const counts = inboxQ.data?.data.counts;
  const current = items.find((i) => itemKey(i) === itemId);

  const candidateOpen = !!itemId?.startsWith('candidate:');
  const draftId = itemId && !candidateOpen ? itemId : undefined;
  const draftQ = useQuery({
    queryKey: ['draft', draftId],
    queryFn: () => fetchDraft(draftId!),
    enabled: !!draftId,
  });
  const draft = draftQ.data?.data;
  const editor = useDraftEditor(draft);
  const presence = useDraftPresence(draftId, editor.focused || editor.dirty ? 'editing' : 'viewing');
  const actions = useInboxActions({ keys, setItem });

  const [cursor, setCursor] = useState<string>();
  const [dismissOpen, setDismissOpen] = useState(false);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [batchOpen, setBatchOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [checkedFor, setCheckedFor] = useState(`${view}|${mailboxId ?? ''}`);
  // Selection belongs to one view: switching view or mailbox clears it.
  if (checkedFor !== `${view}|${mailboxId ?? ''}`) {
    setCheckedFor(`${view}|${mailboxId ?? ''}`);
    setChecked(new Set());
  }
  const recipients = items
    .filter((i) => i.kind === 'draft' && checked.has(i.id))
    .map((i) => ({ id: i.id, name: i.candidate?.name ?? 'Unknown candidate', email: i.candidate?.email ?? '' }));

  const name = draft?.thread?.candidate?.name ?? current?.candidate?.name ?? 'candidate';
  const sendable = isSendable(draft) && draft?.id === draftId;

  const doSend = () => {
    if (!draft || !sendable || actions.sending) return;
    actions.send(draft, editor.body, name, () => editor.reset(editor.body));
  };

  const move = (delta: number) => {
    if (keys.length === 0) return;
    const base = itemId ?? cursor;
    const at = base ? keys.indexOf(base) : -1;
    const next = keys[Math.min(Math.max(at + delta, 0), keys.length - 1)];
    if (itemId) setItem(next);
    else setCursor(next);
  };

  const close = () => {
    if (isTyping(document.activeElement)) {
      document.activeElement.blur();
      return;
    }
    if (itemId) {
      setCursor(itemId);
      setItem(undefined);
    }
  };

  useInboxShortcuts({
    next: () => move(1),
    prev: () => move(-1),
    open: () => {
      if (!itemId && cursor) setItem(cursor);
    },
    edit: () => {
      if (sendable && draft) focusEditor(draft.id);
    },
    send: doSend,
    undo: actions.undoLast,
    dismiss: () => {
      if (sendable) setDismissOpen(true);
    },
    snooze: () => {
      if (sendable) setSnoozeOpen(true);
    },
    close,
    help: () => setHelpOpen(true),
    palette: () => setPaletteOpen((o) => !o),
  });

  const menus =
    draft && itemId ? (
      <>
        <DismissMenu
          open={dismissOpen}
          onOpenChange={setDismissOpen}
          onSelect={(reason) => actions.dismiss(itemId, draft.id, reason)}
        />
        <SnoozeMenu
          open={snoozeOpen}
          onOpenChange={setSnoozeOpen}
          onSelect={(until) => void actions.snooze(itemId, draft.id, until)}
        />
      </>
    ) : null;

  const mobileHeader = (
    <div className="flex gap-2 lg:hidden">
      <Select value={view} onValueChange={(v) => isInboxView(v) && setView(v as InboxView)}>
        <SelectTrigger size="sm" aria-label="View" className="flex-1">
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper" align="start">
          {VIEWS.map((v) => (
            <SelectItem key={v.id} value={v.id}>
              {`${v.label} · ${counts?.[v.id] ?? 0}`}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="flex-1">
        <MailboxSelect mailboxId={mailboxId} onChange={setMailbox} />
      </div>
    </div>
  );

  return (
    <div className="flex h-dvh min-h-0 w-full bg-background text-foreground">
      <aside aria-label="Inbox" className="w-56 shrink-0 overflow-y-auto border-r border-border max-lg:hidden xl:w-60">
        <InboxRail view={view} mailboxId={mailboxId} counts={counts} onMailboxChange={setMailbox} />
      </aside>

      <div
        className={cn(
          'flex min-h-0 w-full flex-col border-r border-border lg:w-80 lg:shrink-0 xl:w-96',
          itemId && 'max-lg:hidden'
        )}
      >
        <InboxList
          view={view}
          items={items}
          total={counts?.[view]}
          loading={inboxQ.isLoading}
          error={inboxQ.isError}
          onRetry={() => void inboxQ.refetch()}
          selectedKey={itemId}
          focusedKey={itemId ? undefined : cursor}
          onOpen={(key) => setItem(key)}
          checked={checked}
          onCheckedChange={setChecked}
          onBatchSend={() => setBatchOpen(true)}
          header={mobileHeader}
        />
      </div>

      <main className={cn('min-h-0 min-w-0 flex-1', !itemId && 'max-lg:hidden')}>
        {candidateOpen && current ? (
          <CandidatePane
            item={current}
            onClose={close}
            onDrafted={(id) => setItem(id)}
            onDone={() => setItem(keys.filter((k) => k !== itemId)[0])}
          />
        ) : itemId ? (
          <ReplyPane
            item={current}
            draft={draft?.id === draftId ? draft : undefined}
            loading={draftQ.isLoading}
            error={draftQ.isError}
            onRetry={() => void draftQ.refetch()}
            editor={editor}
            presence={presence}
            lock={actions.lock}
            onCancelLock={actions.clearLock}
            onClose={() => {
              setCursor(itemId);
              setItem(undefined);
            }}
            onSend={doSend}
            sending={actions.sending}
            onUndo={() => draft && void actions.undo(draft.id)}
            onUnsnooze={() => draft && void actions.unsnooze(draft.id)}
            onRewrite={(instruction) => draft && actions.rewrite(draft, editor.body, editor.dirty, instruction, editor.reset)}
            onRegenerate={() => draft && actions.regenerate(draft, editor.body, editor.dirty, editor.reset)}
            rewriting={actions.rewriting}
            onChangeCc={(cc) => draft && actions.changeCc(draft, cc)}
            menus={menus}
          />
        ) : (
          <Empty className="h-full">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <MousePointerClick />
              </EmptyMedia>
              <EmptyTitle>Pick a reply</EmptyTitle>
              <EmptyDescription>
                Use <Kbd>↑</Kbd> <Kbd>↓</Kbd> and <Kbd>↵</Kbd>, or press <Kbd>?</Kbd> for all shortcuts.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </main>

      <BatchSendDialog
        open={batchOpen}
        onOpenChange={setBatchOpen}
        recipients={recipients}
        onConfirm={async () => {
          const res = await actions.batchSend(recipients.map((r) => r.id));
          if (res) setChecked(new Set());
          return res;
        }}
      />
      <ShortcutHelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
      <InboxCommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onView={setView}
        onHelp={() => setHelpOpen(true)}
        reply={
          sendable && draft
            ? {
                send: doSend,
                edit: () => window.setTimeout(() => focusEditor(draft.id), 0),
                dismiss: () => setDismissOpen(true),
                snooze: () => setSnoozeOpen(true),
              }
            : undefined
        }
      />
    </div>
  );
}
