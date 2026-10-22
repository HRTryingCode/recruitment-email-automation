import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, ArrowLeft, EyeOff, PenLine, X } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchCandidate, generateDraftForThread, ignoreCandidate, type InboxItem } from '@/lib/api';
import { messagePlainText } from '@/lib/inbox';
import { extractApiErrorMessage, toastError, toastSuccess } from '@/lib/toast';
import { formatTimeAgo } from '@/lib/utils';
import { LabelChip } from './chips';

interface Props {
  item: InboxItem;
  onClose: () => void;
  /** A draft was written: open it. */
  onDrafted: (draftId: string) => void;
  /** Candidate ignored: move on. */
  onDone: () => void;
}

/** Needs-review candidate with no draft yet: decide the label to write one, or ignore. */
export default function CandidatePane({ item, onClose, onDrafted, onDone }: Props) {
  const qc = useQueryClient();
  const candidateId = item.candidate?.id ?? item.id;
  const name = item.candidate?.name ?? 'Unknown candidate';
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['candidate', candidateId],
    queryFn: () => fetchCandidate(candidateId),
  });
  const thread = data?.data.threads?.[0];
  const mailboxAddr = item.mailbox?.emailAddress.toLowerCase();
  const latest = [...(thread?.messages ?? [])]
    .reverse()
    .find((m) => m.fromAddress.toLowerCase() !== mailboxAddr);

  const draftMutation = useMutation({
    mutationFn: (classification: 'INTERESTED' | 'NOT_INTERESTED') => generateDraftForThread(thread!.id, classification),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ['inbox'] });
      onDrafted(res.data.id);
    },
    onError: (err) => toastError('Could not write a reply', extractApiErrorMessage(err, 'Please try again.')),
  });
  const ignoreMutation = useMutation({
    mutationFn: () => ignoreCandidate(candidateId),
    onSuccess: () => {
      toastSuccess(`Ignored ${name}`);
      void qc.invalidateQueries({ queryKey: ['inbox'] });
      onDone();
    },
    onError: (err) => toastError('Could not ignore', extractApiErrorMessage(err, 'Please try again.')),
  });

  return (
    <section aria-label={`Reply to ${name}`} className="flex h-full min-h-0 flex-col">
      <header className="flex items-start gap-3 border-b border-border p-4">
        <Button size="icon-sm" variant="ghost" aria-label="Back to list" onClick={onClose} className="lg:hidden">
          <ArrowLeft />
        </Button>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate font-heading text-base font-semibold text-foreground">{name}</h2>
            <LabelChip classification="NEUTRAL" />
          </div>
          <p className="truncate text-sm text-muted-foreground">{item.candidate?.email}</p>
          <p className="text-sm text-muted-foreground">No draft yet — the label was unclear. Pick one to write a reply.</p>
        </div>
        <Button size="icon-sm" variant="ghost" aria-label="Close" onClick={onClose} className="max-lg:hidden">
          <X />
        </Button>
      </header>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : isError ? (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertTitle>Couldn't load this candidate</AlertTitle>
            <AlertDescription>
              <Button size="sm" variant="outline" onClick={() => void refetch()}>
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        ) : latest ? (
          <Card size="sm">
            <CardHeader>
              <CardTitle className="text-sm">{`${latest.fromName ?? name} wrote · ${formatTimeAgo(latest.receivedAt)}`}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="whitespace-pre-wrap text-sm text-foreground">{messagePlainText(latest.bodyText, latest.bodyHtml)}</p>
            </CardContent>
          </Card>
        ) : (
          <p className="text-sm text-muted-foreground">No message from the candidate found.</p>
        )}
      </div>
      <footer className="flex flex-wrap items-center gap-2 border-t border-border p-4">
        <Button disabled={!thread || draftMutation.isPending} onClick={() => draftMutation.mutate('INTERESTED')}>
          <PenLine data-icon="inline-start" />
          Reply as Interested
        </Button>
        <Button variant="outline" disabled={!thread || draftMutation.isPending} onClick={() => draftMutation.mutate('NOT_INTERESTED')}>
          Reply as Not interested
        </Button>
        <Button variant="ghost" disabled={ignoreMutation.isPending} onClick={() => ignoreMutation.mutate()}>
          <EyeOff data-icon="inline-start" />
          Ignore candidate
        </Button>
      </footer>
    </section>
  );
}
