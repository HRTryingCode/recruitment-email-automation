import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { ChevronDown, CircleHelp, Pen, RefreshCw, Tags, Unplug } from 'lucide-react';
import { deleteMailbox, reclassifyMailbox, resyncMailbox, type MailboxSyncHealth } from '../../lib/api';
import { getUser } from '../../lib/auth';
import { formatWatchExpiry, mailboxHealthState } from '../../lib/mailboxHealth';
import { startGmailReconnect } from '../../lib/reconnect';
import { extractApiErrorMessage, toastError, toastSuccess } from '../../lib/toast';
import { cn } from '../../lib/utils';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../ui/alert-dialog';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible';
import { Spinner } from '../ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
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
        <p className="max-w-xs text-xs text-muted-foreground">
          Catch-up sync failed {row.consecutiveReconcileFailures} time{row.consecutiveReconcileFailures === 1 ? '' : 's'} in a row. Try Resync; if it
          keeps failing, ask an admin to check the server logs.
          {row.lastReconcileError && <span className="block font-mono">Details: {row.lastReconcileError.slice(0, 80)}</span>}
        </p>
      )}
    </div>
  );
}

const RECLASSIFY_HELP =
  "Runs Claude again over this mailbox's threads that aren't linked to a candidate yet, so replies it missed show up.";
const MISSED_HELP =
  'How many emails the last catch-up sync found that live updates had missed. A few is normal; 10 or more means live updates are unreliable — try Resync.';

/** A small "?" with a tooltip, next to a label that needs explaining. */
function Help({ label, children }: { label: string; children: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button size="icon-xs" variant="ghost" aria-label={`What is ${label}?`} className="text-muted-foreground">
          <CircleHelp />
        </Button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{children}</TooltipContent>
    </Tooltip>
  );
}

function Detail({ label, help, children, className }: { label: string; help?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="flex items-center gap-1 text-xs text-muted-foreground">
        {label}
        {help && <Help label={label}>{help}</Help>}
      </dt>
      <dd className={cn('min-w-0 text-sm tabular-nums', className)}>{children}</dd>
    </div>
  );
}

/** Everything but status: sync counters, errors and the raw id (support only). */
function MailboxDetails({ row }: { row: MailboxSyncHealth }) {
  return (
    <dl data-testid={`mailbox-details-${row.mailboxId}`} className="grid grid-cols-2 gap-x-6 gap-y-3 py-2 sm:grid-cols-3 lg:grid-cols-4">
      <Detail label="Live updates renew in" className={watchTone(row.watchExpiresInHours)}>
        {formatWatchExpiry(row.watchExpiresInHours)}
      </Detail>
      <Detail label="Last catch-up sync">{fmtDateTime(row.lastReconciliationAt)}</Detail>
      <Detail label="Missed emails found" help={MISSED_HELP} className={cn(row.lastReconciliationFoundMissing >= 10 && 'text-warning')}>
        {row.lastReconciliationFoundMissing}
      </Detail>
      <Detail label="Delivery errors (24h)" className={cn(row.webhookErrorsLast24h >= 10 && 'text-destructive')}>
        {row.webhookErrorsLast24h}
        {row.lastWebhookError && (
          <span className="block truncate font-mono text-xs text-muted-foreground">Details: {row.lastWebhookError.slice(0, 80)}</span>
        )}
      </Detail>
      <Detail label="Messages" className={cn(row.totalMessages === 0 && 'text-destructive')}>
        {row.totalMessages ?? '—'}
      </Detail>
      <Detail label="Candidates">{row.totalCandidates ?? '—'}</Detail>
      <Detail label="Mailbox ID" className="col-span-2 select-all font-mono text-xs text-muted-foreground">
        {row.mailboxId}
      </Detail>
    </dl>
  );
}

/**
 * Settings → Mailboxes: Mailbox · Status · Actions, with sync counters, errors
 * and the raw id behind each row's Details (U2a). Actions: reconnect, resync,
 * re-classify, signature, and (admins) disconnect. Each spinner follows its
 * own request (not a timer).
 */
export default function MailboxHealthTable({ data }: { data: MailboxSyncHealth[] }) {
  const queryClient = useQueryClient();
  const isAdmin = getUser()?.role === 'admin';
  const [reclassified, setReclassified] = useState<Record<string, { threadsFound: number; threadsClassified: number }>>({});
  const [signatureFor, setSignatureFor] = useState<MailboxSyncHealth | null>(null);
  const [disconnectFor, setDisconnectFor] = useState<MailboxSyncHealth | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());

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

  const disconnect = useMutation({
    mutationFn: (row: MailboxSyncHealth) => deleteMailbox(row.mailboxId),
    onMutate: (row) => track(`disconnect:${row.mailboxId}`, true),
    onSettled: (_d, _e, row) => track(`disconnect:${row.mailboxId}`, false),
    onSuccess: (_res, row) => {
      toastSuccess('Mailbox disconnected', row.emailAddress);
      void queryClient.invalidateQueries({ queryKey: ['sync-health'] });
      void queryClient.invalidateQueries({ queryKey: ['mailboxes'] });
    },
    onError: (err) => toastError('Disconnect failed', mailboxActionError(err, 'disconnect')),
  });

  const setRowOpen = (id: string, on: boolean) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Mailbox</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        {data.map((row) => {
          const state = mailboxHealthState(row);
          const resyncing = busy.has(`resync:${row.mailboxId}`);
          const reclassifying = busy.has(`reclassify:${row.mailboxId}`);
          const disconnecting = busy.has(`disconnect:${row.mailboxId}`);
          const rc = reclassified[row.mailboxId];
          const expanded = open.has(row.mailboxId);
          return (
            // One <tbody> per mailbox so its Details row opens right under it.
            <Collapsible key={row.mailboxId} asChild open={expanded} onOpenChange={(on) => setRowOpen(row.mailboxId, on)}>
              <TableBody>
                <TableRow className={cn(expanded && 'border-b-0')}>
                  <TableCell className="max-w-56 truncate font-mono text-sm">{row.emailAddress}</TableCell>
                  <TableCell className="whitespace-normal">
                    <StatusCell row={row} />
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
                        <Tooltip>
                          <TooltipTrigger asChild>
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
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs">{RECLASSIFY_HELP}</TooltipContent>
                        </Tooltip>
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() => setSignatureFor(row)}
                          aria-label={`Preview signature for ${row.emailAddress}`}
                        >
                          <Pen data-icon="inline-start" />
                          Signature
                        </Button>
                        {isAdmin && row.isActive && (
                          <Button
                            size="xs"
                            variant="ghost"
                            disabled={disconnecting}
                            onClick={() => setDisconnectFor(row)}
                            aria-label={`Disconnect ${row.emailAddress}`}
                            className="text-destructive"
                          >
                            {disconnecting ? <Spinner data-icon="inline-start" /> : <Unplug data-icon="inline-start" />}
                            Disconnect
                          </Button>
                        )}
                        <CollapsibleTrigger asChild>
                          <Button size="xs" variant="ghost" aria-label={`Details for ${row.emailAddress}`}>
                            Details
                            <ChevronDown data-icon="inline-end" className={cn('transition-transform', expanded && 'rotate-180')} />
                          </Button>
                        </CollapsibleTrigger>
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
                <CollapsibleContent asChild>
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={3} className="whitespace-normal bg-muted/40">
                      <MailboxDetails row={row} />
                    </TableCell>
                  </TableRow>
                </CollapsibleContent>
              </TableBody>
            </Collapsible>
          );
        })}
      </Table>
      <SignaturePreviewDialog mailbox={signatureFor} onOpenChange={(open) => !open && setSignatureFor(null)} />
      <AlertDialog open={!!disconnectFor} onOpenChange={(open) => !open && setDisconnectFor(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect {disconnectFor?.emailAddress}?</AlertDialogTitle>
            <AlertDialogDescription>
              The app stops receiving live updates from this Gmail account, so new candidate replies to it won't show up.
              Candidates, conversations and drafts already synced are kept. You can connect it again any time with
              Connect Gmail mailbox.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => disconnectFor && disconnect.mutate(disconnectFor)}>
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
