import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Radar, Trash2 } from 'lucide-react';
import {
  fetchSenderCoverage,
  fetchExpectedSenders,
  upsertExpectedSender,
  deleteExpectedSender,
} from '../lib/api';
import { cn } from '../lib/utils';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible';
import { Input } from './ui/input';
import { Separator } from './ui/separator';
import { toastError, toastSuccess, extractApiErrorMessage } from '../lib/toast';
import QueryError from './shell/QueryError';

// Sender coverage (audit H2). Lists expected senders (e.g. Gem send-aliases)
// that no connected mailbox or sendAs alias covers — replies to those are
// invisible to the app — and connected mailboxes with no outbound while
// sends are expected. Expanding shows the admin-maintained list.

function sendsLabel(n: number | null): string {
  return n === null ? 'volume unknown' : `~${n} sends / 30d`;
}

function isForbidden(err: unknown): boolean {
  return (err as { response?: { status?: number } } | null)?.response?.status === 403;
}

function ExpectedSendersAdmin() {
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const { data, error, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['expected-senders'],
    queryFn: fetchExpectedSenders,
    retry: false,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['expected-senders'] });
    qc.invalidateQueries({ queryKey: ['sender-coverage'] });
  };

  const add = useMutation({
    mutationFn: (emailAddress: string) => upsertExpectedSender({ emailAddress }),
    onSuccess: () => {
      setEmail('');
      invalidate();
      toastSuccess('Expected sender added');
    },
    onError: (err) => toastError('Could not add sender', extractApiErrorMessage(err, 'Check the address.')),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteExpectedSender(id),
    onSuccess: invalidate,
    onError: (err) => toastError('Could not remove sender', extractApiErrorMessage(err, 'Try again.')),
  });

  // Recruiters can see the report but not maintain the list.
  if (isForbidden(error)) return null;
  if (error) return <QueryError thing="the expected-senders list" onRetry={() => void refetch()} retrying={isFetching} />;

  const senders = data?.data ?? [];
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-medium text-muted-foreground">Expected senders (admin)</p>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const v = email.trim();
          if (v) add.mutate(v);
        }}
      >
        <Input
          aria-label="Expected sender email"
          placeholder="alias@archive.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Button type="submit" disabled={add.isPending || !email.trim()}>
          Add
        </Button>
      </form>
      {isLoading ? null : (
        <ul className="flex flex-col">
          {senders.map((s, i) => (
            <li key={s.id}>
              {i > 0 && <Separator />}
              <div className="flex items-center gap-2 py-1.5 text-sm">
                <span className={cn('flex-1 truncate', !s.isActive && 'text-muted-foreground line-through')}>
                  {s.emailAddress}
                </span>
                <Badge variant="outline">{s.source}</Badge>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Remove ${s.emailAddress}`}
                  onClick={() => remove.mutate(s.id)}
                >
                  <Trash2 />
                </Button>
              </div>
            </li>
          ))}
          {senders.length === 0 && <li className="py-1.5 text-sm text-muted-foreground">No expected senders yet.</li>}
        </ul>
      )}
    </div>
  );
}

export default function UnmonitoredSenders() {
  const [open, setOpen] = useState(false);
  const { data, error } = useQuery({
    queryKey: ['sender-coverage'],
    queryFn: fetchSenderCoverage,
    retry: false,
    staleTime: 5 * 60_000,
  });

  const report = data?.data;
  if (error || !report) return null;

  const gaps = report.unmonitored.length + report.quietMailboxes.length;
  const summary =
    gaps === 0
      ? 'All expected senders are monitored.'
      : [
          report.unmonitored.length > 0 && `${report.unmonitored.length} unmonitored`,
          report.quietMailboxes.length > 0 && `${report.quietMailboxes.length} quiet mailbox(es)`,
        ]
          .filter(Boolean)
          .join(' · ');

  return (
    <Collapsible open={open} onOpenChange={setOpen} asChild>
      <Card data-testid="sender-coverage">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Radar className={cn('size-4', gaps > 0 ? 'text-warning' : 'text-success')} />
            Sender coverage
            {gaps > 0 && <Badge variant="warning">{gaps} gap{gaps === 1 ? '' : 's'}</Badge>}
          </CardTitle>
          <CardDescription>{summary}</CardDescription>
          <CardAction>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" aria-label="Sender coverage: expected senders">
                Expected senders
                <ChevronDown data-icon="inline-end" className={cn('transition-transform', open && 'rotate-180')} />
              </Button>
            </CollapsibleTrigger>
          </CardAction>
        </CardHeader>

        {gaps > 0 && (
          <CardContent className="flex flex-col gap-3">
            {report.unmonitored.length > 0 && (
              <div>
                <p className="mb-1 text-xs text-muted-foreground">
                  Replies to these senders are not reaching the app. Connect the mailbox, add the alias as a
                  Gmail send-as on a connected mailbox, or route replies.
                </p>
                <ul className="flex flex-col gap-1">
                  {report.unmonitored.map((u) => (
                    <li key={u.emailAddress} className="flex items-baseline gap-2 text-sm">
                      <span className="font-medium">{u.emailAddress}</span>
                      <span className="text-xs text-muted-foreground">{sendsLabel(u.expectedSends30d)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {report.quietMailboxes.length > 0 && (
              <div>
                <p className="mb-1 text-xs text-muted-foreground">
                  Connected, but no outbound mail in {report.windowDays} days while sends are expected:
                </p>
                <ul className="flex flex-col gap-1">
                  {report.quietMailboxes.map((q) => (
                    <li key={q.mailboxId} className="flex flex-wrap items-baseline gap-2 text-sm">
                      <span className="font-medium">{q.emailAddress}</span>
                      <span className="text-xs text-muted-foreground">
                        expected from {q.expectedAddresses.join(', ')} · {sendsLabel(q.expectedSends30d)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        )}

        <CollapsibleContent>
          <CardContent>
            <ExpectedSendersAdmin />
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
