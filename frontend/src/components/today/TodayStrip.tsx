import { Link } from 'react-router-dom';
import { CheckCircle2 } from 'lucide-react';
import type { TodaySummary } from '../../lib/api';
import { viewHref } from '../../lib/urlState';
import { Badge } from '../ui/badge';
import { Card, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Skeleton } from '../ui/skeleton';

/** Matches the Inbox's overdue flag: a reply waiting more than 2 days. */
const SLA_MS = 2 * 24 * 3600_000;

/** Compact age: "< 1m", "45m", "5h", "2d 4h", "3d". */
export function formatWaitingAge(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return '< 1m';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return rest ? `${days}d ${rest}h` : `${days}d`;
}

function Tile({ to, label, value, hint }: { to: string; label: string; value: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <Link to={to} className="group block focus-visible:outline-none">
      <Card
        size="sm"
        className="h-full transition-colors group-hover:bg-muted/50 group-focus-visible:ring-2 group-focus-visible:ring-ring"
      >
        <CardHeader>
          <CardDescription>{label}</CardDescription>
          <CardTitle className="text-2xl font-semibold tabular-nums">{value}</CardTitle>
          {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
        </CardHeader>
      </Card>
    </Link>
  );
}

export default function TodayStrip({
  summary,
  params,
  now = Date.now(),
}: {
  summary: TodaySummary | undefined;
  params: URLSearchParams;
  now?: number;
}) {
  const inbox = (view?: string) => viewHref('/inbox', params, { view });

  if (!summary) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} data-testid="today-skeleton" className="h-24" />
        ))}
      </div>
    );
  }

  const { views } = summary;
  const waiting = views.needs_review + views.interested + views.not_interested;
  const age = summary.oldestWaitingAt ? now - new Date(summary.oldestWaitingAt).getTime() : null;

  return (
    <section aria-label="Today" className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Tile to={inbox('needs_review')} label="Needs review" value={views.needs_review} />
        <Tile to={inbox('interested')} label="Interested" value={views.interested} />
        <Tile to={inbox('not_interested')} label="Not interested" value={views.not_interested} />
        <Tile to={inbox('sent_today')} label="Sent today" value={summary.sentToday} />
        <Tile
          to={inbox()}
          label="Oldest waiting"
          value={age === null ? '—' : formatWaitingAge(age)}
          hint={age !== null && age > SLA_MS ? <Badge variant="warning">Over 2 days</Badge> : 'Reply within 2 days'}
        />
        <Tile to={inbox()} label="Expiring soon" value={summary.draftsExpiringSoon} hint="Drafts expiring in 24h" />
      </div>
      {waiting === 0 && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <CheckCircle2 className="size-4 text-success" />
          Nothing waiting — the Inbox is clear.
        </p>
      )}
    </section>
  );
}
