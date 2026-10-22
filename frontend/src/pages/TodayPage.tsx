import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { fetchMailboxes, fetchSyncHealth, fetchToday } from '../lib/api';
import { useMailboxFilter } from '../lib/urlState';
import ActivityChart from '../components/today/ActivityChart';
import LeverSnapshot from '../components/today/LeverSnapshot';
import MailboxTable from '../components/today/MailboxTable';
import TodayStrip from '../components/today/TodayStrip';
import PageHeader from '../components/shell/PageHeader';
import QueryError from '../components/shell/QueryError';

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
      <PageHeader heading="Today" description="Replies waiting, what went out, and what's next for Lever." />

      {today.isError ? (
        <QueryError
          thing="today's summary"
          description="The server returned an error. Try again in a moment."
          onRetry={() => void today.refetch()}
          retrying={today.isFetching}
        />
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
