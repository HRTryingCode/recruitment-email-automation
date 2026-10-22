import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { Pen, RefreshCw, Tags } from 'lucide-react';
import { reclassifyMailbox, resyncMailbox, type MailboxSyncHealth } from '../../lib/api';
import { formatWatchExpiry, mailboxHealthState } from '../../lib/mailboxHealth';
import { startGmailReconnect } from '../../lib/reconnect';
import { extractApiErrorMessage, toastError, toastSuccess } from '../../lib/toast';
import { cn } from '../../lib/utils';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Spinner } from '../ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import SignaturePreviewDialog from './SignaturePreviewDialog';

/** A specific, actionable message for a failed resync / re-classify. */
export function mailboxActionError(err: unknown, action: string): string {
  if (axios.isAxiosError(err)) {
    const status = err.response?.status;
    if (status === 403) return `Only admins can ${action} mailboxes.`;
    if (status === 401) return 'Your session expired — sign in again.';
    const msg = extractApiErrorMessage(err, '');
    if (/invalid_grant|oauth|credentials|auth/i.test(msg)) {
      return 'Google rejected this mailbox’s login — reconnect it first, then try again.';
    }
    if (msg) return msg;
    if (!err.response) return 'Could not reach the server — check your connection and try again.';
  }
  return extractApiErrorMessage(err, `Could not ${action} this mailbox. Try again in a moment.`);
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function watchTone(h: number | null): string {
  if (h === null) return 'text-muted-foreground';
  if (h < 0) return 'text-destructive';
  if (h < 24) return 'text-warning';
  return '';
}

function StatusCell({ row }: { row: MailboxSyncHealth }) {
  const state = mailboxHealthState(row);
  return (
    <div className="flex flex-col items-start gap-1">
      <div className="flex flex-wrap gap-1">
        {state === 'reconnect' && <Badge variant="destructive">Reconnect required</Badge>}
        {state === 'failing' && <Badge variant="destructive">Not syncing</Badge>}
        {state === 'ok' && <Badge variant="success">Syncing</Badge>}
        {!row.isActive && <Badge variant="outline">Inactive</Badge>}
        {row.error && <Badge variant="warning">Some counts unavailable</Badge>}
      </div>
      {state === 'reconnect' && (
        <p className="max-w-xs text-xs text-muted-foreground">
          {row.authStatus === 'NEEDS_REAUTH'
            ? `Google rejected the login (${row.lastAuthError ?? 'unknown error'})${row.lastAuthErrorAt ? ` since ${new Date(row.lastAuthErrorAt).toLocaleDateString()}` : ''}.`
            : 'Gmail stopped sending live updates.'}{' '}
          Sign in as this mailbox to reconnect, then resync.
        </p>
      )}
      {state === 'failing' && (
        <p className="max-w-xs text-xs text-muted-foreground" title={row.lastReconcileError?.slice(0, 200) ?? undefined}>
          Catch-up sync failed {row.consecutiveReconcileFailures} time{row.consecutiveReconcileFailures === 1 ? '' : 's'} in a row. Try Resync; if it
          keeps failing, ask an admin to check the server logs.
        </p>
      )}
    </div>
  );
}

/**
 * Settings → Mailboxes health table: Gmail live-update (watch) expiry,
 * catch-up (reconcile) drift and delivery (webhook) errors per mailbox, plus reconnect / resync / re-classify / signature.
 * Each action's spinner follows its own request (not a timer).
 */
export default function MailboxHealthTable({ data }: { data: MailboxSyncHealth[] }) {
  const queryClient = useQueryClient();
  const [reclassified, setReclassified] = useState<Record<string, { threadsFound: number; threadsClassified: number }>>({});
  const [signatureFor, setSignatureFor] = useState<MailboxSyncHealth | null>(null);

  // Ids with a request in flight — a Set so concurrent rows keep their own spinner.
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const track = (key: string, on: boolean) =>
    setBusy((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });

  const resync = useMutation({
    mutationFn: (mailboxId: string) => resyncMailbox(mailboxId),
    onMutate: (mailboxId) => track(`resync:${mailboxId}`, true),
    onSettled: (_d, _e, mailboxId) => track(`resync:${mailboxId}`, false),
    onSuccess: (res, mailboxId) => {
      const email = data.find((d) => d.mailboxId === mailboxId)?.emailAddress ?? 'Mailbox';
      toastSuccess('Resync finished', `${email}: ${res.data.messagesStored} stored / ${res.data.messagesSeen} seen.`);
      void queryClient.invalidateQueries({ queryKey: ['sync-health'] });
      void queryClient.invalidateQueries({ queryKey: ['drafts'] });
    },
    onError: (err) => toastError('Resync failed', mailboxActionError(err, 'resync')),
  });

  const reclassify = useMutation({
    mutationFn: (mailboxId: string) => reclassifyMailbox(mailboxId),
    onMutate: (mailboxId) => track(`reclassify:${mailboxId}`, true),
    onSettled: (_d, _e, mailboxId) => track(`reclassify:${mailboxId}`, false),
    onSuccess: (res, mailboxId) => setReclassified((prev) => ({ ...prev, [mailboxId]: res.data })),
    onError: (err) => toastError('Re-classify failed', mailboxActionError(err, 're-classify')),
  });

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Mailbox</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Live updates renew in</TableHead>
            <TableHead className="hidden lg:table-cell">Messages</TableHead>
            <TableHead className="hidden lg:table-cell">Candidates</TableHead>
            <TableHead className="hidden md:table-cell">Last catch-up sync</TableHead>
            <TableHead>Missed emails found</TableHead>
            <TableHead>Delivery errors (24h)</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((row) => {
            const state = mailboxHealthState(row);
            const resyncing = busy.has(`resync:${row.mailboxId}`);
            const reclassifying = busy.has(`reclassify:${row.mailboxId}`);
            const rc = reclassified[row.mailboxId];
            return (
              <TableRow key={row.mailboxId}>
                <TableCell>
                  <p className="font-mono text-sm">{row.emailAddress}</p>
                  <p className="select-all font-mono text-xs text-muted-foreground">{row.mailboxId}</p>
                </TableCell>
                <TableCell className="whitespace-normal">
                  <StatusCell row={row} />
                </TableCell>
                <TableCell className={cn('font-mono tabular-nums', watchTone(row.watchExpiresInHours))}>
                  {formatWatchExpiry(row.watchExpiresInHours)}
                </TableCell>
                <TableCell className={cn('hidden font-mono tabular-nums lg:table-cell', row.totalMessages === 0 && 'text-destructive')}>
                  {row.totalMessages ?? '—'}
                </TableCell>
                <TableCell className="hidden font-mono tabular-nums lg:table-cell">{row.totalCandidates ?? '—'}</TableCell>
                <TableCell className="hidden text-muted-foreground md:table-cell">{fmtDateTime(row.lastReconciliationAt)}</TableCell>
                <TableCell className={cn('font-mono tabular-nums', row.lastReconciliationFoundMissing >= 10 && 'text-warning')}>
                  {row.lastReconciliationFoundMissing}
                </TableCell>
                <TableCell className={cn('whitespace-normal', row.webhookErrorsLast24h >= 10 && 'text-destructive')}>
                  <span className="font-mono tabular-nums">{row.webhookErrorsLast24h}</span>
                  {row.lastWebhookError && (
                    <p className="max-w-48 truncate text-xs text-muted-foreground" title={row.lastWebhookError.slice(0, 200)}>
                      Latest error details on hover
                    </p>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex flex-col items-end gap-1">
                    <div className="flex flex-wrap justify-end gap-1">
                      {state === 'reconnect' && (
                        <Button size="xs" onClick={() => void startGmailReconnect()} aria-label={`Reconnect ${row.emailAddress}`}>
                          Reconnect
                        </Button>
                      )}
                      <Button
                        size="xs"
                        variant="outline"
                        disabled={resyncing}
                        onClick={() => resync.mutate(row.mailboxId)}
                        aria-label={`Resync ${row.emailAddress}`}
                      >
                        {resyncing ? <Spinner data-icon="inline-start" /> : <RefreshCw data-icon="inline-start" />}
                        {resyncing ? 'Resyncing…' : 'Resync'}
                      </Button>
                      <Button
                        size="xs"
                        variant="outline"
                        disabled={reclassifying}
                        onClick={() => reclassify.mutate(row.mailboxId)}
                        aria-label={`Re-classify unlinked threads in ${row.emailAddress}`}
                      >
                        {reclassifying ? <Spinner data-icon="inline-start" /> : <Tags data-icon="inline-start" />}
                        {reclassifying ? 'Classifying…' : 'Re-classify'}
                      </Button>
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() => setSignatureFor(row)}
                        aria-label={`Preview signature for ${row.emailAddress}`}
                      >
                        <Pen data-icon="inline-start" />
                        Signature
                      </Button>
                    </div>
                    {rc && (
                      <p className="text-xs text-muted-foreground">
                        {rc.threadsFound === 0
                          ? 'No orphaned threads found'
                          : `${rc.threadsClassified}/${rc.threadsFound} threads classified`}
                      </p>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <SignaturePreviewDialog mailbox={signatureFor} onOpenChange={(open) => !open && setSignatureFor(null)} />
    </>
  );
}
