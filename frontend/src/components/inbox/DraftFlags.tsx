import { memo } from 'react';
import { AlertCircle, Circle, Hourglass, Pencil } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { expiresIn } from '@/lib/inbox';
import { firstName } from './chips';

export interface DraftFlagFields {
  status: string;
  sendError?: string | null;
  returnedFromSnoozeAt?: string | null;
  hasEdits?: boolean;
  editedByName?: string | null;
  expiresAt?: string | null;
}

/**
 * State a recruiter must not miss, shared by inbox rows and the reply pane:
 * a failed send, a snooze that ran out, someone's edits, an expiry coming up.
 */
function DraftFlags({ flags, now }: { flags: DraftFlagFields; now?: number }) {
  const failed = flags.status === 'FAILED';
  const expiry = expiresIn(flags.expiresAt, now);
  const edited = !!flags.hasEdits;
  if (!failed && !flags.returnedFromSnoozeAt && !edited && !expiry) return null;
  return (
    <>
      {failed && (
        <Badge variant="destructive" data-flag="failed" title={flags.sendError ?? 'Check Gmail Sent before retrying.'}>
          <AlertCircle data-icon="inline-start" />
          Send failed
        </Badge>
      )}
      {flags.returnedFromSnoozeAt && (
        <Badge variant="info" data-flag="unsnoozed">
          <Circle data-icon="inline-start" aria-hidden="true" className="fill-current" />
          Back from snooze
        </Badge>
      )}
      {edited && (
        <Badge variant="outline" data-flag="edited" className="text-muted-foreground">
          <Pencil data-icon="inline-start" />
          {flags.editedByName ? `Edited by ${firstName(flags.editedByName)}` : 'Edited'}
        </Badge>
      )}
      {expiry && (
        <Badge variant="warning" data-flag="expiry">
          <Hourglass data-icon="inline-start" />
          {expiry}
        </Badge>
      )}
    </>
  );
}

export default memo(DraftFlags);
