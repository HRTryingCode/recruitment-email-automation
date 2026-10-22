import { useQuery } from '@tanstack/react-query';
import { Inbox, Plus } from 'lucide-react';
import { fetchMailboxes, fetchSyncHealth } from '../../lib/api';
import { summarizeHealth } from '../../lib/mailboxHealth';
import { startGmailReconnect } from '../../lib/reconnect';
import MailboxHealthTable from '../../components/settings/MailboxHealthTable';
import ResyncAllButton from '../../components/settings/ResyncAllButton';
import UnmonitoredSenders from '../../components/UnmonitoredSenders';
import { Alert, AlertDescription, AlertTitle } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '../../components/ui/empty';
import { Skeleton } from '../../components/ui/skeleton';

const TONE_VARIANT = { emerald: 'success', amber: 'warning', rose: 'destructive', neutral: 'secondary' } as const;

export default function MailboxesSettings() {
  const { data: mailboxesData } = useQuery({ queryKey: ['mailboxes'], queryFn: fetchMailboxes, staleTime: 60_000 });
  const { data, isLoading, isError } = useQuery({
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
            {!isLoading && !isError && <Badge variant={TONE_VARIANT[summary.tone]}>{summary.label}</Badge>}
          </CardTitle>
          <CardDescription>Watch tokens, reconciliation drift and webhook errors per connected mailbox.</CardDescription>
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
            <Alert variant="destructive">
              <AlertTitle>Could not load mailbox health</AlertTitle>
              <AlertDescription>The server returned an error. Check the Vercel logs, or reload in a minute.</AlertDescription>
            </Alert>
          ) : health.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Inbox />
                </EmptyMedia>
                <EmptyTitle>No mailboxes connected</EmptyTitle>
                <EmptyDescription>Connect a Gmail account to start syncing candidate replies.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <MailboxHealthTable data={health} />
          )}
        </CardContent>
      </Card>
      <UnmonitoredSenders />
    </div>
  );
}
