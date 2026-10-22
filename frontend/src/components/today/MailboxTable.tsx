import { Link } from 'react-router-dom';
import { Circle, Inbox } from 'lucide-react';
import type { Mailbox, MailboxSyncHealth, TodaySummary } from '../../lib/api';
import { mailboxHealthState, type MailboxHealthState } from '../../lib/mailboxHealth';
import { viewHref } from '../../lib/urlState';
import { cn, formatTimeAgo } from '../../lib/utils';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '../ui/empty';
import { Skeleton } from '../ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';

type Health = MailboxHealthState | 'unknown';

const HEALTH: Record<Health, { label: string; dot: string }> = {
  ok: { label: 'Healthy', dot: 'fill-success text-success' },
  failing: { label: 'Not syncing', dot: 'fill-warning text-warning' },
  reconnect: { label: 'Reconnect required', dot: 'fill-destructive text-destructive' },
  unknown: { label: 'Unknown', dot: 'fill-muted-foreground/40 text-muted-foreground/40' },
};

function HealthDot({ state, settingsHref }: { state: Health; settingsHref: string }) {
  const { label, dot } = HEALTH[state];
  const content = (
    <>
      <Circle className={cn('size-2', dot)} aria-hidden />
      {label}
    </>
  );
  if (state === 'ok' || state === 'unknown') {
    return <span className="inline-flex items-center gap-1.5 text-muted-foreground">{content}</span>;
  }
  // Unhealthy: the fix lives in Settings → Mailboxes.
  return (
    <Button asChild variant="link" size="sm" className="h-auto px-0">
      <Link to={settingsHref} aria-label={`${label} — open Settings → Mailboxes`}>
        {content}
      </Link>
    </Button>
  );
}

export default function MailboxTable({
  summary,
  mailboxes,
  health,
  params,
}: {
  summary: TodaySummary | undefined;
  mailboxes: Mailbox[];
  /** undefined while sync-health loads or when it failed. */
  health: MailboxSyncHealth[] | undefined;
  params: URLSearchParams;
}) {
  const settingsHref = viewHref('/settings/mailboxes', params);
  const healthById = new Map((health ?? []).map((h) => [h.mailboxId, h]));
  const nameById = new Map(mailboxes.map((m) => [m.id, m.emailAddress]));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Mailboxes</CardTitle>
        <CardDescription>Waiting replies and today's activity per inbox.</CardDescription>
      </CardHeader>
      <CardContent>
        {!summary ? (
          <Skeleton data-testid="today-skeleton" className="h-32" />
        ) : summary.mailboxes.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Inbox />
              </EmptyMedia>
              <EmptyTitle>No mailboxes connected</EmptyTitle>
              <EmptyDescription>Connect a Gmail account to start syncing candidate replies.</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button asChild size="sm" variant="outline">
                <Link to={settingsHref}>Connect a mailbox</Link>
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          <Table aria-label="Mailboxes">
            <TableHeader>
              <TableRow>
                <TableHead>Mailbox</TableHead>
                <TableHead className="text-right">Waiting</TableHead>
                <TableHead className="text-right">Sent today</TableHead>
                <TableHead className="max-sm:hidden">Last received</TableHead>
                <TableHead>Health</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {summary.mailboxes.map((m) => {
                const h = healthById.get(m.mailboxId);
                const state: Health = h ? mailboxHealthState(h) : 'unknown';
                const name = nameById.get(m.mailboxId) ?? h?.emailAddress ?? 'Unknown mailbox';
                return (
                  <TableRow key={m.mailboxId}>
                    <TableCell className="max-w-48 truncate font-medium">{name}</TableCell>
                    <TableCell className="text-right tabular-nums">{m.waiting}</TableCell>
                    <TableCell className="text-right tabular-nums">{m.sentToday}</TableCell>
                    <TableCell className="text-muted-foreground max-sm:hidden">
                      {m.lastReceivedAt ? formatTimeAgo(m.lastReceivedAt) : '—'}
                    </TableCell>
                    <TableCell>
                      <HealthDot state={state} settingsHref={settingsHref} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
