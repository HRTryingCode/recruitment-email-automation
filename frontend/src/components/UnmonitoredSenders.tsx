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
import { Button } from './ui/button';
import { Input } from './ui/input';
import { toastError, toastSuccess, extractApiErrorMessage } from '../lib/toast';

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
  const { data, error, isLoading } = useQuery({
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
  if (error) return <p className="text-[11.5px] text-fg-muted">Could not load the expected-senders list.</p>;

  return (
    <div className="space-y-2">
      <p className="text-[11.5px] font-medium uppercase tracking-wide text-fg-muted">
        Expected senders (admin)
      </p>
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
          className="h-8 text-[12.5px]"
        />
        <Button type="submit" size="sm" disabled={add.isPending || !email.trim()}>
          Add
        </Button>
      </form>
      {isLoading ? null : (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {(data?.data ?? []).map((s) => (
            <li key={s.id} className="flex items-center gap-2 px-3 py-1.5 text-[12.5px]">
              <span className={cn('flex-1 truncate', !s.isActive && 'text-fg-muted line-through')}>
                {s.emailAddress}
              </span>
              <span className="text-[11px] text-fg-muted">{s.source}</span>
              <button
                type="button"
                aria-label={`Remove ${s.emailAddress}`}
                onClick={() => remove.mutate(s.id)}
                className="rounded p-1 text-fg-muted hover:text-rose-600"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
          {(data?.data ?? []).length === 0 && (
            <li className="px-3 py-1.5 text-[12px] text-fg-muted">No expected senders yet.</li>
          )}
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
    <section
      data-testid="sender-coverage"
      className={cn(
        'overflow-hidden rounded-xl border bg-surface-raised/60',
        gaps > 0 ? 'border-amber-500/40' : 'border-line'
      )}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="sender-coverage-detail"
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-fg-strong/[0.02]"
      >
        <div
          className={cn(
            'flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg ring-1 ring-inset',
            gaps > 0
              ? 'bg-amber-500/10 text-amber-700 ring-amber-500/20 dark:text-amber-300'
              : 'bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 dark:text-emerald-300'
          )}
        >
          <Radar className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-fg-strong">Sender coverage</p>
          <p className="mt-0.5 text-[11.5px] text-fg-muted">{summary}</p>
        </div>
        <ChevronDown
          className={cn('h-4 w-4 flex-shrink-0 text-fg-muted transition-transform', open && 'rotate-180 text-fg-strong')}
        />
      </button>

      {gaps > 0 && (
        <div className="space-y-3 border-t border-line px-4 py-3">
          {report.unmonitored.length > 0 && (
            <div>
              <p className="mb-1 text-[11.5px] text-fg-muted">
                Replies to these senders are not reaching the app. Connect the mailbox, add the alias as a
                Gmail send-as on a connected mailbox, or route replies.
              </p>
              <ul className="space-y-1">
                {report.unmonitored.map((u) => (
                  <li key={u.emailAddress} className="flex items-baseline gap-2 text-[12.5px]">
                    <span className="font-medium text-fg-strong">{u.emailAddress}</span>
                    <span className="text-[11.5px] text-fg-muted">{sendsLabel(u.expectedSends30d)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {report.quietMailboxes.length > 0 && (
            <div>
              <p className="mb-1 text-[11.5px] text-fg-muted">
                Connected, but no outbound mail in {report.windowDays} days while sends are expected:
              </p>
              <ul className="space-y-1">
                {report.quietMailboxes.map((q) => (
                  <li key={q.mailboxId} className="flex flex-wrap items-baseline gap-2 text-[12.5px]">
                    <span className="font-medium text-fg-strong">{q.emailAddress}</span>
                    <span className="text-[11.5px] text-fg-muted">
                      expected from {q.expectedAddresses.join(', ')} · {sendsLabel(q.expectedSends30d)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {open && (
        <div id="sender-coverage-detail" className="border-t border-line px-4 py-3">
          <ExpectedSendersAdmin />
        </div>
      )}
    </section>
  );
}
