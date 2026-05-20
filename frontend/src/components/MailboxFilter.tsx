import { Mail } from 'lucide-react';
import type { Mailbox } from '../lib/api';

interface Props {
  mailboxes: Mailbox[];
  selectedId?: string;
  onChange: (id: string | undefined) => void;
}

const PROVIDER_COLORS = {
  GMAIL: 'text-red-400',
  OUTLOOK: 'text-blue-400',
  IMAP: 'text-gray-400',
};

export default function MailboxFilter({ mailboxes, selectedId, onChange }: Props) {
  return (
    <div className="relative">
      <select
        value={selectedId ?? ''}
        onChange={(e) => onChange(e.target.value || undefined)}
        className="appearance-none bg-gray-800 border border-gray-700 text-gray-300 text-sm rounded-lg pl-3 pr-8 py-1.5 focus:outline-none focus:border-blue-500 cursor-pointer"
      >
        <option value="">All Mailboxes</option>
        {mailboxes.map((mb) => (
          <option key={mb.id} value={mb.id}>
            {mb.emailAddress}
          </option>
        ))}
      </select>

      {selectedId && (
        <span className="absolute right-8 top-1/2 -translate-y-1/2 pointer-events-none">
          {(() => {
            const mb = mailboxes.find((m) => m.id === selectedId);
            const colorClass = mb ? PROVIDER_COLORS[mb.provider] : 'text-gray-400';
            return <Mail className={`w-3.5 h-3.5 ${colorClass}`} />;
          })()}
        </span>
      )}
    </div>
  );
}
