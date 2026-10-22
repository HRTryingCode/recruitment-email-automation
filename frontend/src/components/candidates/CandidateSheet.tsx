import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Copy, Inbox, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import LeverSection from '@/components/lever/LeverSection';
import QueryError from '@/components/shell/QueryError';
import { fetchCandidate, generateDraftForThread, type Candidate, type EmailMessage, type EmailThread } from '@/lib/api';
import { LIVE_DRAFT_STATUSES as LIVE_DRAFT } from '@/lib/candidates';
import { messagePlainText } from '@/lib/inbox';
import { extractApiErrorMessage, toastError, toastSuccess } from '@/lib/toast';
import { viewHref } from '@/lib/urlState';
import { formatDate, formatTimeAgo } from '@/lib/utils';
import CandidateMenu, { type CandidateMenuHandlers } from './CandidateMenu';
import { CandidateMailboxChip, ReplyLabelChip, RoleChip } from './chips';


export function candidateQueryOptions(id: string) {
  return { queryKey: ['candidate', id] as const, queryFn: () => fetchCandidate(id), staleTime: 30_000 };
}

function isFromCandidate(m: EmailMessage, email: string): boolean {
  return m.fromAddress.toLowerCase() === email.toLowerCase();
}

interface Props {
  candidateId: string | undefined;
  /** The list row, shown while the full record loads. */
  row?: Candidate;
  onClose: () => void;
  onCopy: (email: string) => void;
  /** Menu actions for the loaded candidate (triage needs its threads). */
  menuFor: (c: Candidate) => CandidateMenuHandlers;
}

/** Candidates side panel (R3): every thread, Lever, past outreach, Inbox link. */
export default function CandidateSheet({ candidateId, row, onClose, onCopy, menuFor }: Props) {
  const q = useQuery({ ...candidateQueryOptions(candidateId ?? ''), enabled: !!candidateId });
  const c = q.data?.data ?? row;

  return (
    <Sheet open={!!candidateId} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        className="w-full gap-0 data-[side=right]:w-full sm:data-[side=right]:max-w-xl"
      >
        {!c ? (
          <SheetHeader>
            <SheetTitle>{q.isError ? 'Candidate not found' : 'Loading…'}</SheetTitle>
            {q.isLoading && <Skeleton className="h-24 w-full" />}
          </SheetHeader>
        ) : (
          <SheetBody candidate={c} detailLoaded={!!q.data} detailError={q.isError} onRetry={() => void q.refetch()} onCopy={onCopy} {...menuFor(c)} />
        )}
      </SheetContent>
    </Sheet>
  );
}

function SheetBody({
  candidate: c,
  detailLoaded,
  detailError,
  onRetry,
  onCopy,
  ...menu
}: { candidate: Candidate; detailLoaded: boolean; detailError: boolean; onRetry: () => void; onCopy: (email: string) => void } & CandidateMenuHandlers) {
  const [params] = useSearchParams();
  const threads = c.threads ?? [];
  const liveDraft = threads
    .flatMap((t) => t.drafts ?? [])
    .filter((d) => LIVE_DRAFT.has(d.status))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const outreach = threads
    .flatMap((t) => (t.messages ?? []).filter((m) => !isFromCandidate(m, c.email)).map((m) => ({ m, t })))
    .sort((a, b) => a.m.receivedAt.localeCompare(b.m.receivedAt));

  return (
    <>
      <SheetHeader className="gap-2 border-b border-border pr-14">
        <SheetTitle className="truncate">{c.name}</SheetTitle>
        <SheetDescription className="truncate">{c.email}</SheetDescription>
        <div className="flex flex-wrap items-center gap-1.5">
          <ReplyLabelChip candidate={c} />
          <RoleChip role={c.role} />
          {c.mailbox && <CandidateMailboxChip email={c.mailbox.emailAddress} />}
        </div>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {liveDraft && (
            <Button asChild size="sm">
              <Link to={viewHref('/inbox', params, { item: liveDraft.id })}>
                <Inbox data-icon="inline-start" />
                Open in Inbox
              </Link>
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => onCopy(c.email)}>
            <Copy data-icon="inline-start" />
            Copy email
          </Button>
          <CandidateMenu candidate={c} {...menu} />
        </div>
      </SheetHeader>

      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-6">
        <section aria-labelledby="sheet-lever" className="flex flex-col gap-2">
          <h3 id="sheet-lever" className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Lever
          </h3>
          <LeverSection candidateId={c.id} lever={c} />
        </section>

        <Separator />

        {detailError ? (
          <QueryError thing="the conversation" onRetry={onRetry} />
        ) : !detailLoaded ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <>
            <section aria-labelledby="sheet-outreach" className="flex flex-col gap-2">
              <h3 id="sheet-outreach" className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Past outreach
              </h3>
              {outreach.length === 0 ? (
                <p className="text-sm text-muted-foreground">No outreach found in connected mailboxes.</p>
              ) : (
                <ul className="flex flex-col gap-1 text-sm">
                  {outreach.map(({ m, t }) => (
                    <li key={m.id} className="flex min-w-0 items-baseline gap-2">
                      <span className="shrink-0 text-muted-foreground tabular-nums">{formatDate(m.receivedAt)}</span>
                      <span className="truncate">{m.subject || t.subject}</span>
                      <span className="ml-auto shrink-0 truncate text-xs text-muted-foreground">{m.fromName ?? m.fromAddress}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <Separator />

            <section aria-labelledby="sheet-threads" className="flex flex-col gap-4">
              <h3 id="sheet-threads" className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {threads.length === 1 ? 'Conversation' : `Conversations (${threads.length})`}
              </h3>
              {threads.length === 0 && <p className="text-sm text-muted-foreground">No messages yet.</p>}
              {threads.map((t) => (
                <ThreadCard key={t.id} thread={t} candidate={c} />
              ))}
            </section>
          </>
        )}
      </div>
    </>
  );
}

function ThreadCard({ thread, candidate }: { thread: EmailThread; candidate: Candidate }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [generating, setGenerating] = useState(false);
  const messages = thread.messages ?? [];
  const hasLiveDraft = (thread.drafts ?? []).some((d) => LIVE_DRAFT.has(d.status));

  const generate = async () => {
    setGenerating(true);
    try {
      const res = await generateDraftForThread(thread.id);
      void qc.invalidateQueries({ queryKey: ['candidate', candidate.id] });
      void qc.invalidateQueries({ queryKey: ['inbox'] });
      const draftId = res.data?.id;
      toastSuccess('Draft ready', `Reply to ${candidate.name} is waiting in the Inbox.`, {
        label: 'Review in Inbox',
        onClick: () => navigate(viewHref('/inbox', params, { item: draftId })),
      });
    } catch (err) {
      toastError("Couldn't generate a draft", extractApiErrorMessage(err, 'Please try again.'), {
        label: 'Retry',
        onClick: () => void generate(),
      });
    } finally {
      setGenerating(false);
    }
  };

  return (
    <Card size="sm" data-testid="sheet-thread">
      <CardHeader>
        <CardTitle className="truncate text-sm">{thread.subject || '(no subject)'}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {messages.map((m) => {
          const theirs = isFromCandidate(m, candidate.email);
          return (
            <div key={m.id} data-from={theirs ? 'candidate' : 'us'} className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
                <span className="truncate font-medium text-foreground">
                  {m.fromName ?? m.fromAddress}
                  {!theirs && <span className="font-normal text-muted-foreground"> · you</span>}
                </span>
                <span className="shrink-0 tabular-nums">{formatTimeAgo(m.receivedAt)}</span>
              </div>
              <p className="line-clamp-6 whitespace-pre-wrap text-sm text-foreground">{messagePlainText(m.bodyText, m.bodyHtml)}</p>
            </div>
          );
        })}
        {!hasLiveDraft && messages.length > 0 && (
          <Button size="sm" variant="outline" className="self-start" disabled={generating} onClick={() => void generate()}>
            {generating ? <Spinner data-icon="inline-start" aria-hidden /> : <Sparkles data-icon="inline-start" />}
            {generating ? 'Generating…' : 'Generate draft'}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
