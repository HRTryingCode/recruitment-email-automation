import { Inbox } from 'lucide-react';
import type { Mailbox } from '../lib/api';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

interface Props {
  mailboxes: Mailbox[];
  selectedId?: string;
  onChange: (id: string | undefined) => void;
}

// Radix Select can't use '' as an item value.
const ALL = '__all__';

export default function MailboxFilter({ mailboxes, selectedId, onChange }: Props) {
  if (mailboxes.length === 0) return null;

  return (
    <Select value={selectedId ?? ALL} onValueChange={(v) => onChange(v === ALL ? undefined : v)}>
      <SelectTrigger size="sm" aria-label="Mailbox filter" className="max-w-56">
        <Inbox />
        <SelectValue placeholder="All mailboxes" />
      </SelectTrigger>
      <SelectContent align="end">
        <SelectItem value={ALL}>All mailboxes</SelectItem>
        {mailboxes.map((mb) => (
          <SelectItem key={mb.id} value={mb.id}>
            {mb.emailAddress}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
