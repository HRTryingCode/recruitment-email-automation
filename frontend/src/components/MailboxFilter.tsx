import { Inbox, ChevronDown } from 'lucide-react';
import type { Mailbox } from '../lib/api';

interface Props {
  mailboxes: Mailbox[];
  selectedId?: string;
  onChange: (id: string | undefined) => void;
}

export default function MailboxFilter({ mailboxes, selectedId, onChange }: Props) {
  if (mailboxes.length === 0) return null;

  return (
    <div className="relative">
      <select
        value={selectedId ?? ''}
        onChange={(e) => onChange(e.target.value || undefined)}
        className="hidden appearance-none rounded-lg border border-line bg-surface-raised/70 py-1.5 pl-8 pr-8 text-[13px] text-fg-default transition-colors hover:border-line-strong focus:border-accent-400 focus:outline-none sm:block"
      >
        <option value="">All Mailboxes</option>
        {mailboxes.map((mb) => (
          <option key={mb.id} value={mb.id}>
            {mb.emailAddress}
          </option>
        ))}
      </select>
      <Inbox className="pointer-events-none absolute left-2.5 top-1/2 hidden h-3.5 w-3.5 -translate-y-1/2 text-fg-muted sm:block" />
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 hidden h-3.5 w-3.5 -translate-y-1/2 text-fg-muted sm:block" />
    </div>
  );
}
