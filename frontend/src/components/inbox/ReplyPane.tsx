import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlarmClock, AlertCircle, ArrowLeft, ChevronDown, Lock, Send, Undo2, X } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Kbd, KbdGroup } from '@/components/ui/kbd';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import DraftCcSelect from '@/components/DraftCcSelect';
import {
  fetchDraftCcOptions,
  type Candidate,
  type DraftPresenceEntry,
  type EmailDraft,
  type InboxItem,
  type LeverCandidateFields,
} from '@/lib/api';
import { messagePlainText, sendLine } from '@/lib/inbox';
import { formatTimeAgo } from '@/lib/utils';
import type { DraftEditorState } from '@/hooks/useDraftEditor';
import { LabelChip, PresenceChip, firstName } from './chips';
import DraftEditor from './DraftEditor';
import EvidenceMessage from './EvidenceMessage';
import LeverSection, { type LeverFields } from './LeverSection';

export interface LockState {
  name: string;
  /** "Send anyway", "Dismiss anyway", … */
  actionLabel: string;
  retry: () => void;
}

/** Statuses a recruiter can still send (FAILED = retry). */
export function isSendable(draft: Pick<EmailDraft, 'status'> | undefined): boolean {
  return !!draft && (draft.status === 'PENDING' || draft.status === 'FAILED' || draft.status === 'APPROVED');
}

/** Blocking notice for a 423: never silent, explicit override. */
export function LockedAlert({ lock, onCancel }: { lock: LockState; onCancel: () => void }) {
  return (
    <Alert variant="destructive">
      <Lock />
      <AlertTitle>{`${firstName(lock.name)} is editing this reply`}</AlertTitle>
      <AlertDescription className="flex flex-col gap-2">
        <span>They opened it first. Sending now may overwrite their changes.</span>
        <span className="flex flex-wrap gap-2">
          <Button size="sm" variant="destructive" onClick={lock.retry}>
            {lock.actionLabel}
          </Button>
          <Button size="sm" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        </span>
      </AlertDescription>
    </Alert>
  );
}

function ThreadContext({ draft }: { draft: EmailDraft }) {
  const originalId = draft.originalMessage?.id;
  const earlier = (draft.thread?.messages ?? []).filter((m) => m.id !== originalId);
  if (earlier.length === 0) return null;
  return (
    <Collapsible>
      <CollapsibleTrigger asChild>
        <Button size="sm" variant="ghost">
          <ChevronDown data-icon="inline-start" />
          {`${earlier.length} earlier ${earlier.length === 1 ? 'message' : 'messages'}`}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-3 pt-2">
        {earlier.map((m) => (
          <div key={m.id} className="flex flex-col gap-1 border-l-2 border-border pl-3">
            <p className="text-xs text-muted-foreground">
              {`${m.fromName ?? m.fromAddress} · ${formatTimeAgo(m.receivedAt)}`}
            </p>
            <p className="whitespace-pre-wrap text-sm text-foreground">{messagePlainText(m.bodyText, m.bodyHtml)}</p>
          </div>
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

function useCcFirstName(draft: EmailDraft): string | null {
  const { data } = useQuery({
    queryKey: ['draft-cc-options', draft.id],
    queryFn: () => fetchDraftCcOptions(draft.id),
    staleTime: 5 * 60 * 1000,
  });
  const cc = draft.ccAddress;
  if (!cc) return null;
  const opt = data?.data.find((o) => o.email?.toLowerCase() === cc.toLowerCase());
  return opt?.firstName ?? opt?.name ?? cc.split('@')[0];
}

function StatusNotice({ draft, onUndo, onUnsnooze }: { draft: EmailDraft; onUndo: () => void; onUnsnooze: () => void }) {
  if (draft.status === 'FAILED') {
    return (
      <Alert variant="destructive">
        <AlertCircle />
        <AlertTitle>The last send failed</AlertTitle>
        <AlertDescription>{draft.sendError ?? 'Check Gmail Sent before retrying.'}</AlertDescription>
      </Alert>
    );
  }
  if (draft.status === 'SCHEDULED' || draft.status === 'SENDING') {
    return (
      <Alert>
        <Send />
        <AlertTitle>Sending…</AlertTitle>
        <AlertDescription>
          {draft.status === 'SCHEDULED' && (
            <Button size="sm" variant="outline" onClick={onUndo}>
              <Undo2 data-icon="inline-start" />
              Undo send
            </Button>
          )}
        </AlertDescription>
      </Alert>
    );
  }
  if (draft.status === 'SENT') {
    return (
      <Alert>
        <Send />
        <AlertTitle>{`Sent ${draft.sentAt ? formatTimeAgo(draft.sentAt) : ''}`.trim()}</AlertTitle>
      </Alert>
    );
  }
  if (draft.snoozedUntil && new Date(draft.snoozedUntil).getTime() > Date.now()) {
    return (
      <Alert>
        <AlarmClock />
        <AlertTitle>{`Snoozed until ${new Date(draft.snoozedUntil).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`}</AlertTitle>
        <AlertDescription>
          <Button size="sm" variant="outline" onClick={onUnsnooze}>
            Unsnooze
          </Button>
        </AlertDescription>
      </Alert>
    );
  }
  return null;
}

interface Props {
  item?: InboxItem;
  draft?: EmailDraft;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  editor: DraftEditorState;
  presence: DraftPresenceEntry[];
  lock: LockState | null;
  onCancelLock: () => void;
  onClose: () => void;
  onSend: () => void;
  sending: boolean;
  onUndo: () => void;
  onUnsnooze: () => void;
  onRewrite: (instruction: string) => void;
  onRegenerate: () => void;
  rewriting: boolean;
  onChangeCc: (ccEmail: string | null) => void;
  /** Dismiss and Snooze menus (owned by the page so D/S can open them). */
  menus: ReactNode;
}

export default function ReplyPane(props: Props) {
  const { item, draft, loading, error, onRetry, editor, presence, lock, onCancelLock, onClose } = props;
  const name = draft?.thread?.candidate?.name ?? item?.candidate?.name ?? 'Unknown candidate';

  if (loading || (!draft && !error)) {
    return (
      <div aria-label="Loading reply" className="flex flex-col gap-3 p-6">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }
  if (error || !draft) {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>Couldn't load this reply</AlertTitle>
          <AlertDescription>
            <Button size="sm" variant="outline" onClick={onRetry}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const candidate = (draft.thread?.candidate ?? null) as (Candidate & LeverCandidateFields) | null;
  const candidateId = candidate?.id ?? item?.candidate?.id;
  // The draft's candidate row has every Lever column (checked time, archived
  // reason); the inbox item has the core ones and is the fallback.
  const lever: LeverFields = {
    leverState: (candidate?.leverState ?? item?.candidate?.leverState ?? null) as LeverFields['leverState'],
    leverOpportunityId: candidate?.leverOpportunityId ?? item?.candidate?.leverOpportunityId ?? null,
    leverPostingTitle: candidate?.leverPostingTitle ?? item?.candidate?.leverPostingTitle ?? null,
    leverStage: candidate?.leverStage ?? item?.candidate?.leverStage ?? null,
    leverArchivedReason: candidate?.leverArchivedReason ?? null,
    leverCheckedAt: candidate?.leverCheckedAt ?? null,
    leverError: candidate?.leverError ?? null,
  };
  const role = candidate?.role ?? item?.candidate?.role ?? null;
  const mailbox = draft.thread?.mailbox?.emailAddress ?? item?.mailbox?.emailAddress ?? '';
  const original = draft.originalMessage;
  const sendable = isSendable(draft);

  return (
    <section aria-label={`Reply to ${name}`} className="flex h-full min-h-0 flex-col">
      <header className="flex items-start gap-3 border-b border-border p-4">
        <Button size="icon-sm" variant="ghost" aria-label="Back to list" onClick={onClose} className="lg:hidden">
          <ArrowLeft />
        </Button>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate font-heading text-base font-semibold text-foreground">{name}</h2>
            <LabelChip classification={draft.classification} confidenceLabel={draft.confidenceLabel} />
            <PresenceChip presence={presence} />
          </div>
          <p className="truncate text-sm text-muted-foreground">
            {[candidate?.email ?? item?.candidate?.email, role].filter(Boolean).join(' · ')}
          </p>
          {candidateId && <LeverSection candidateId={candidateId} lever={lever} draftId={draft.id} />}
          {draft.classificationReason && (
            <p className="text-sm text-foreground">
              <span className="text-muted-foreground">Why: </span>
              <span>{draft.classificationReason}</span>
            </p>
          )}
        </div>
        <Button size="icon-sm" variant="ghost" aria-label="Close" onClick={onClose} className="max-lg:hidden">
          <X />
        </Button>
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <StatusNotice draft={draft} onUndo={props.onUndo} onUnsnooze={props.onUnsnooze} />

        {original && (
          <Card size="sm">
            <CardHeader>
              <CardTitle className="text-sm">
                {`${firstName(original.fromName ?? name)} wrote · ${formatTimeAgo(original.receivedAt)}`}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <EvidenceMessage body={messagePlainText(original.bodyText, original.bodyHtml)} quote={draft.evidenceQuote} />
            </CardContent>
          </Card>
        )}

        <ThreadContext draft={draft} />

        <Separator />

        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium text-foreground">Your reply</h3>
          <DraftCcSelect draft={draft} onChange={props.onChangeCc} />
          <DraftEditor
            draft={draft}
            editor={editor}
            editable={sendable}
            rewriting={props.rewriting}
            onRewrite={props.onRewrite}
            onRegenerate={props.onRegenerate}
          />
        </div>
      </div>

      {sendable && (
        <footer className="flex flex-col gap-3 border-t border-border p-4">
          {lock && <LockedAlert lock={lock} onCancel={onCancelLock} />}
          <SendLine draft={draft} mailbox={mailbox} />
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={props.onSend} disabled={props.sending}>
              {props.sending ? <Spinner data-icon="inline-start" /> : <Send data-icon="inline-start" />}
              Send
              <KbdGroup className="max-sm:hidden">
                <Kbd>⌘</Kbd>
                <Kbd>↵</Kbd>
              </KbdGroup>
            </Button>
            {props.menus}
          </div>
        </footer>
      )}
    </section>
  );
}

function SendLine({ draft, mailbox }: { draft: EmailDraft; mailbox: string }) {
  const cc = useCcFirstName(draft);
  return <p className="text-xs text-muted-foreground">{sendLine(mailbox, cc)}</p>;
}
