import { Mail, Plus } from 'lucide-react';
import { startGmailReconnect } from '../../lib/reconnect';
import { Button } from '../ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '../ui/empty';

/**
 * First-run onboarding: nothing can arrive until a Gmail mailbox is
 * connected, so say that instead of "Inbox zero".
 */
export default function ConnectMailboxCard({ className }: { className?: string }) {
  return (
    <Empty className={className}>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Mail />
        </EmptyMedia>
        <EmptyTitle role="heading" aria-level={2}>
          Connect a Gmail mailbox
        </EmptyTitle>
        <EmptyDescription>
          Candidate replies show up here once a recruiting Gmail account is connected. Sign in with Google to start syncing.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button onClick={() => void startGmailReconnect()}>
          <Plus data-icon="inline-start" />
          Connect Gmail
        </Button>
      </EmptyContent>
    </Empty>
  );
}
