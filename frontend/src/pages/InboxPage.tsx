import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MousePointerClick } from 'lucide-react';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Kbd } from '@/components/ui/kbd';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import BatchSendDialog from '@/components/inbox/BatchSendDialog';
import CandidatePane from '@/components/inbox/CandidatePane';
import DismissMenu from '@/components/inbox/DismissMenu';
import DraftedBanner from '@/components/inbox/DraftedBanner';
import { focusEditor } from '@/components/inbox/DraftEditor';
import InboxList, { itemKey } from '@/components/inbox/InboxList';
import InboxRail from '@/components/inbox/InboxRail';
import ReplyPane, { isSendable } from '@/components/inbox/ReplyPane';
import ShortcutHelpDialog from '@/components/inbox/ShortcutHelpDialog';
import SnoozeMenu from '@/components/inbox/SnoozeMenu';
import { useDraftEditor } from '@/hooks/useDraftEditor';
import { useDraftPresence } from '@/hooks/useDraftPresence';
import { useInboxActions } from '@/hooks/useInboxActions';
import { useInboxShortcuts } from '@/hooks/useInboxShortcuts';
import { useInboxUrlState } from '@/hooks/useInboxUrlState';
import { useTriageDraft, type TriageResult } from '@/hooks/useTriageDraft';
import { fetchCandidate, fetchDraft, fetchInbox, type InboxView } from '@/lib/api';
import { fetchLeverMe } from '@/lib/leverApi';
import { prefetchAddToLever } from '@/lib/leverQueries';
import { toastWarning } from '@/lib/toast';
import { VIEWS, isInboxView, nextItemId } from '@/lib/inbox';
import { cn } from '@/lib/utils';

export const INBOX_POLL_MS = 15_000;

/** Draft statuses a legacy ?candidateId= link can land on. */
const LIVE_STATUSES = new Set(['PENDING', 'APPROVED', 'FAILED', 'SCHEDULED', 'SENDING']);

/** How long a row that just arrived in a view stays highlighted. */
const HIGHLIGHT_MS = 4000;

/** A triage draft just written (H8): where it went and whether the list stays put. */
interface TriageState {
  result: TriageResult;
  /** The view the recruiter was working through. */
  from: InboxView;
  /** Keep listing `from` while the draft is open, until "Go to …". */
  stay: boolean;
  banner: boolean;
  /** The draft has been open at least once; leaving it ends the flow. */
  seen: boolean;
}

function isTyping(el: Element | null): el is HTMLElement {
  return el instanceof HTMLElement && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
}

/**
 * The R2 Inbox: one keyboard-first queue replacing the Drafts tab and the
 * dashboard's Quick triage. Every reply ends in Send (with undo), Dismiss
 * or Snooze, and the next one opens automatically.
 */
export default function InboxPage() {
  const qc = useQueryClient();
  const { view, mailboxId, itemId, legacyCandidateId, setView, setItem, setPlace, resolveCandidate } = useInboxUrlState();

  // H8: after a triage draft the URL already names the draft's new view (so a
  // refresh lands on it), but the list stays on the view being worked through.
  const [triage, setTriage] = useState<TriageState | null>(null);
  const [highlight, setHighlight] = useState<string>();
  const onTriageDraft = !!triage && itemId === triage.result.draft.id;
  const listView = triage?.stay && onTriageDraft ? triage.from : view;
  if (triage && onTriageDraft && !triage.seen) setTriage({ ...triage, seen: true });
  if (triage?.seen && !onTriageDraft) setTriage(null);
  useEffect(() => {
    if (!highlight) return;
    const t = window.setTimeout(() => setHighlight(undefined), HIGHLIGHT_MS);
    return () => window.clearTimeout(t);
  }, [highlight]);
  /** Open an item in the list being shown (which may differ from the URL's view mid-flow). */
  const openItem = useCallback(
    (key?: string) => (listView !== view ? setPlace(listView, key) : setItem(key)),
    [listView, view, setPlace, setItem]
  );

  const inboxQ = useQuery({
    queryKey: ['inbox', listView, mailboxId ?? null],
    queryFn: () => fetchInbox({ view: listView, mailboxId }),
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
  const actions = useInboxActions({ keys, setItem: openItem });

  const itemIdRef = useRef(itemId);
  const listViewRef = useRef(listView);
  useEffect(() => {
    itemIdRef.current = itemId;
    listViewRef.current = listView;
  });
  const showDraft = (result: TriageResult, stay: boolean) => {
    setTriage({ result, from: listViewRef.current, stay, banner: true, seen: false });
    setPlace(result.view, result.draft.id);
  };
  const triageDraft = useTriageDraft({
    currentKey: () => itemIdRef.current,
    onDrafted: (result, inPlace) => {
      if (inPlace) showDraft(result, true);
    },
    onOpen: (result) => {
      showDraft(result, false);
      setHighlight(result.draft.id);
    },
  });

  // Legacy ?candidateId= (old Drafts tab, Today, Slack): open that
  // candidate's row if it's in this view, else their newest live draft.
  const listReady = !!inboxQ.data;
  useEffect(() => {
    if (!legacyCandidateId || !listReady) return;
    const hit = items.find((i) => i.candidate?.id === legacyCandidateId);
    if (hit) {
      resolveCandidate(itemKey(hit));
      return;
    }
    let alive = true;
    fetchCandidate(legacyCandidateId)
      .then((res) => {
        if (!alive) return;
        const live = (res.data.threads ?? [])
          .flatMap((t) => t.drafts ?? [])
          .filter((d) => LIVE_STATUSES.has(d.status))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
        if (!live) toastWarning(`No reply waiting for ${res.data.name}`);
        resolveCandidate(live?.id);
      })
      .catch(() => {
        if (alive) resolveCandidate(undefined);
      });
    return () => {
      alive = false;
    };
  }, [legacyCandidateId, listReady, items, resolveCandidate]);

  // H5: warm the Add to Lever dialog for the selected candidate.
  const { data: leverMe } = useQuery({ queryKey: ['lever-me'], queryFn: fetchLeverMe, staleTime: 5 * 60_000, retry: false });
  const leverReady = !!leverMe?.configured && !!leverMe.createEnabled && !!leverMe.leverUser;
  const selectedCandidateId = draft?.thread?.candidate?.id ?? current?.candidate?.id;
  useEffect(() => {
    if (leverReady && selectedCandidateId) prefetchAddToLever(qc, { candidateId: selectedCandidateId });
  }, [leverReady, selectedCandidateId, qc]);

  const [cursor, setCursor] = useState<string>();
  const [dismissOpen, setDismissOpen] = useState(false);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [batchOpen, setBatchOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
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
    if (itemId) openItem(next);
    else setCursor(next);
  };

  const close = () => {
    if (isTyping(document.activeElement)) {
      document.activeElement.blur();
      return;
    }
    if (itemId) {
      setCursor(itemId);
      openItem(undefined);
    }
  };

  useInboxShortcuts({
    next: () => move(1),
    prev: () => move(-1),
    open: () => {
      if (!itemId && cursor) openItem(cursor);
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
    <div className="flex gap-2 xl:hidden">
      <Select value={listView} onValueChange={(v) => isInboxView(v) && setView(v as InboxView)}>
        <SelectTrigger size="sm" aria-label="View" className="w-full">
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
    </div>
  );

  return (
    <div className="flex min-h-0 w-full flex-1 bg-background text-foreground">
      <aside aria-label="Inbox" className="w-52 shrink-0 overflow-y-auto border-r border-border max-xl:hidden 2xl:w-56">
        <InboxRail view={listView} counts={counts} />
      </aside>

      <div
        className={cn(
          'flex min-h-0 w-full flex-col border-r border-border lg:w-80 lg:shrink-0 xl:w-96',
          itemId && 'max-lg:hidden'
        )}
      >
        <InboxList
          view={listView}
          items={items}
          total={counts?.[view]}
          loading={inboxQ.isLoading}
          error={inboxQ.isError}
          onRetry={() => void inboxQ.refetch()}
          selectedKey={itemId}
          focusedKey={itemId ? undefined : cursor}
          highlightKey={highlight}
          onOpen={(key) => openItem(key)}
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
            onReply={(threadId, classification) => triageDraft.start(itemId!, current, threadId, classification)}
            pending={triageDraft.pendingFor(itemId!)}
            error={triageDraft.errorFor(itemId!)}
            onRetry={() => triageDraft.retry(itemId!)}
            onDone={() => openItem(nextItemId(keys, itemId!) ?? undefined)}
          />
        ) : itemId ? (
          <div className="flex h-full min-h-0 flex-col">
            {triage?.banner && onTriageDraft && (
              <div className="px-4 pt-4">
                <DraftedBanner
                  result={triage.result}
                  onReview={() => focusEditor(triage.result.draft.id)}
                  onGo={
                    listView !== triage.result.view
                      ? () => {
                          setTriage({ ...triage, stay: false });
                          setHighlight(triage.result.draft.id);
                        }
                      : undefined
                  }
                  onDismiss={() => setTriage({ ...triage, banner: false })}
                />
              </div>
            )}
            <div className="min-h-0 flex-1">
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
                  openItem(undefined);
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
            </div>
          </div>
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
    </div>
  );
}
