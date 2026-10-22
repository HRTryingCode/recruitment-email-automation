import type { Mailbox } from '../../lib/api';
import LookupBar from '../LookupBar';
import MailboxFilter from '../MailboxFilter';
import ThemeToggle from '../ThemeToggle';
import { Separator } from '../ui/separator';
import { SidebarTrigger } from '../ui/sidebar';
import AccountMenu from './AccountMenu';

interface Props {
  mailboxes: Mailbox[];
  mailboxId?: string;
  onMailboxChange: (id: string | undefined) => void;
}

export default function AppHeader({ mailboxes, mailboxId, onMailboxChange }: Props) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-1 h-4" />
      <LookupBar />
      <div className="ml-auto flex items-center gap-1 sm:gap-2">
        <MailboxFilter mailboxes={mailboxes} selectedId={mailboxId} onChange={onMailboxChange} />
        <ThemeToggle />
        <AccountMenu />
      </div>
    </header>
  );
}
