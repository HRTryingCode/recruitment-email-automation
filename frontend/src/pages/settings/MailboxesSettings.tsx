import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { fetchMailboxes, fetchSyncHealth } from '../../lib/api';
import { summarizeHealth } from '../../lib/mailboxHealth';
import { startGmailReconnect } from '../../lib/reconnect';
import MailboxHealthTable from '../../components/settings/MailboxHealthTable';
import ResyncAllButton from '../../components/settings/ResyncAllButton';
import UnmonitoredSenders from '../../components/UnmonitoredSenders';
import ConnectMailboxCard from '../../components/shell/ConnectMailboxCard';
import NotificationsSettings from '../../components/settings/NotificationsSettings';
import QueryError from '../../components/shell/QueryError';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Skeleton } from '../../components/ui/skeleton';

export default function MailboxesSettings() {
  const { data: mailboxesData } = useQuery({ queryKey: ['mailboxes'], queryFn: fetchMailboxes, staleTime: 60_000 });
  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ['sync-health'],
    queryFn: fetchSyncHealth,
    staleTime: 60_000,
    retry: 1,
  });
  const mailboxes = mailboxesData?.data ?? [];
  const health = data?.data ?? [];
  const summary = summarizeHealth(health);

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            Mailbox health
            {!isLoading && !isError && <Badge variant={summary.tone}>{summary.label}</Badge>}
          </CardTitle>
          <CardDescription>Whether each connected Gmail account is still signed in and syncing new replies.</CardDescription>
          <CardAction className="flex flex-wrap items-start justify-end gap-2">
            <ResyncAllButton mailboxes={mailboxes} />
            <Button size="sm" onClick={() => void startGmailReconnect()}>
              <Plus data-icon="inline-start" />
              Add mailbox
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-32" />
          ) : isError ? (
            <QueryError
              thing="mailbox health"
              description="Something went wrong loading mailboxes. Try again, or ask an admin to check the server logs."
              onRetry={() => void refetch()}
              retrying={isFetching}
            />
          ) : health.length === 0 ? (
            <ConnectMailboxCard />
          ) : (
            <MailboxHealthTable data={health} />
          )}
        </CardContent>
      </Card>
      <UnmonitoredSenders />
      <NotificationsSettings />
    </div>
  );
}
