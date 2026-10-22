import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { resyncMailbox, type Mailbox, type ResyncResult } from '../../lib/api';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Spinner } from '../ui/spinner';
import { mailboxActionError } from './MailboxHealthTable';

interface Outcome {
  email: string;
  ok: boolean;
  data?: ResyncResult;
  error?: string;
}

export default function ResyncAllButton({ mailboxes }: { mailboxes: Mailbox[] }) {
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<Outcome[] | null>(null);

  const run = async () => {
    setRunning(true);
    setResults(null);
    const outcomes = await Promise.all(
      mailboxes.map(async (mb): Promise<Outcome> => {
        try {
          const res = await resyncMailbox(mb.id);
          return { email: mb.emailAddress, ok: true, data: res.data };
        } catch (err) {
          return { email: mb.emailAddress, ok: false, error: mailboxActionError(err, 'resync') };
        }
      })
    );
    setResults(outcomes);
    setRunning(false);
  };

  return (
    <div className="flex flex-col items-end gap-2">
      <Button variant="outline" size="sm" onClick={() => void run()} disabled={running || mailboxes.length === 0}>
        {running ? <Spinner data-icon="inline-start" /> : <RefreshCw data-icon="inline-start" />}
        {running ? 'Resyncing…' : 'Resync all'}
      </Button>
      {results && (
        <ul aria-label="Resync results" className="flex flex-col items-end gap-1">
          {results.map((r) => (
            <li key={r.email} className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">{r.email}</span>
              {r.ok ? (
                <Badge variant="success">
                  {r.data?.messagesStored ?? 0} stored / {r.data?.messagesSeen ?? 0} seen
                </Badge>
              ) : (
                <Badge variant="destructive">{r.error ?? 'failed'}</Badge>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
