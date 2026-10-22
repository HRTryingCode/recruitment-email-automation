import EmailDrafts from '../components/EmailDrafts';
import { useMailboxFilter } from '../lib/urlState';

// R2 replaces this with the keyboard-first Inbox.
export default function InboxPage() {
  const [mailboxId] = useMailboxFilter();
  return <EmailDrafts mailboxId={mailboxId} />;
}
