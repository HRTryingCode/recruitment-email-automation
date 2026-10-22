import { Mail, Plus } from 'lucide-react';
import { startGmailReconnect } from '../../lib/reconnect';
import { Button } from '../ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '../ui/empty';

/** The one label for starting Gmail sign-in (header, empty states, ⌘K). */
export const CONNECT_MAILBOX_LABEL = 'Connect Gmail mailbox';

const BODY: Record<ConnectMailboxContext, string> = {
  inbox: 'Candidate replies show up here once a recruiting Gmail account is connected. Sign in with Google to start syncing.',
  today: "Today's summary fills in once a recruiting Gmail account is connected. Sign in with Google to start syncing.",
  settings:
    'No mailbox is connected yet. Sign in with Google as the recruiting Gmail account whose candidate replies you want to sync.',
};

export type ConnectMailboxContext = 'inbox' | 'settings' | 'today';

/**
 * First-run onboarding: nothing can arrive until a Gmail mailbox is
 * connected, so say that instead of "Inbox zero". `context` picks the copy.
 */
export default function ConnectMailboxCard({ context, className }: { context: ConnectMailboxContext; className?: string }) {
  return (
    <Empty className={className} data-context={context}>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Mail />
        </EmptyMedia>
        <EmptyTitle role="heading" aria-level={2}>
          Connect a Gmail mailbox
        </EmptyTitle>
        <EmptyDescription>{BODY[context]}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button onClick={() => void startGmailReconnect()}>
          <Plus data-icon="inline-start" />
          {CONNECT_MAILBOX_LABEL}
        </Button>
      </EmptyContent>
    </Empty>
  );
}
