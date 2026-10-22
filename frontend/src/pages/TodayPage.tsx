import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { fetchMailboxes, fetchSyncHealth, fetchToday } from '../lib/api';
import { useMailboxFilter } from '../lib/urlState';
import ActivityChart from '../components/today/ActivityChart';
import LeverSnapshot from '../components/today/LeverSnapshot';
import MailboxTable from '../components/today/MailboxTable';
import TodayStrip from '../components/today/TodayStrip';
import { Alert, AlertAction, AlertDescription, AlertTitle } from '../components/ui/alert';
import { Button } from '../components/ui/button';

/**
 * R4: a glanceable summary, not a console. Triage lives in the Inbox,
 * mailbox health and admin tools in Settings; this page only links there.
 */
export default function TodayPage() {
  const [mailboxId] = useMailboxFilter();
  const [params] = useSearchParams();

  const today = useQuery({
    queryKey: ['today', { mailboxId }],
    queryFn: () => fetchToday({ mailboxId }),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  // Shared with the shell and Settings (same keys), so usually cached.
  const mailboxes = useQuery({ queryKey: ['mailboxes'], queryFn: fetchMailboxes, staleTime: 60_000 });
  const health = useQuery({ queryKey: ['sync-health'], queryFn: fetchSyncHealth, staleTime: 60_000, retry: 1 });

  const summary = today.data?.data;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Today</h1>
        <p className="text-sm text-muted-foreground">Replies waiting, what went out, and what's next for Lever.</p>
      </div>

      {today.isError ? (
        <Alert variant="destructive">
          <AlertTitle>Couldn't load today's summary</AlertTitle>
          <AlertDescription>The server returned an error. Try again in a moment.</AlertDescription>
          <AlertAction>
            <Button size="sm" variant="outline" onClick={() => void today.refetch()} disabled={today.isFetching}>
              <RefreshCw data-icon="inline-start" />
              Retry
            </Button>
          </AlertAction>
        </Alert>
      ) : (
        <>
          <TodayStrip summary={summary} params={params} />
          <div className="grid items-start gap-6 lg:grid-cols-3">
            <div className="flex min-w-0 flex-col gap-6 lg:col-span-2">
              <MailboxTable
                summary={summary}
                mailboxes={mailboxes.data?.data ?? []}
                health={health.data?.data}
                params={params}
              />
              <ActivityChart summary={summary} />
            </div>
            <LeverSnapshot summary={summary} params={params} />
          </div>
        </>
      )}
    </div>
  );
}
