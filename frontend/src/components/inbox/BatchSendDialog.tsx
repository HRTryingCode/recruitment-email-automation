import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/spinner';
import type { BatchSendResult } from '@/lib/api';
import { firstName } from './chips';

export interface Recipient {
  id: string;
  name: string;
  email: string;
}

const SKIP_TEXT: Record<BatchSendResult['skipped'][number]['reason'], string> = {
  locked: 'is being edited',
  not_pending: 'already handled',
  not_batchable: 'not a Not interested reply',
  not_found: 'no longer exists',
  no_candidate: 'no candidate on the thread',
};

export function skipText(s: BatchSendResult['skipped'][number]): string {
  return s.reason === 'locked' && s.lockedBy ? `${firstName(s.lockedBy)} is editing` : SKIP_TEXT[s.reason];
}

function plural(n: number): string {
  return `${n} ${n === 1 ? 'reply' : 'replies'}`;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recipients: Recipient[];
  /** Resolves with the server result, or undefined if the request failed. */
  onConfirm: () => Promise<BatchSendResult | undefined>;
}

/** One review step for batch-sending Not interested replies; reports what was skipped. */
export default function BatchSendDialog({ open, onOpenChange, recipients, onConfirm }: Props) {
  const [pending, setPending] = useState(false);
  // The result keeps its own recipient snapshot: the list refetches (and the
  // selection clears) as soon as the batch is scheduled.
  const [result, setResult] = useState<{ res: BatchSendResult; names: Map<string, string> } | null>(null);
  const title = `Send ${plural(recipients.length)}`;

  const change = (next: boolean) => {
    if (!next) setResult(null);
    onOpenChange(next);
  };

  const confirm = async () => {
    setPending(true);
    const names = new Map(recipients.map((r) => [r.id, r.name]));
    const res = await onConfirm();
    setPending(false);
    if (res && res.skipped.length > 0) setResult({ res, names });
    else change(false);
  };

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent>
        {result ? (
          <>
            <DialogHeader>
              <DialogTitle>{`${result.res.scheduled.length} sent, ${result.res.skipped.length} skipped`}</DialogTitle>
              <DialogDescription>Skipped replies stay in the inbox.</DialogDescription>
            </DialogHeader>
            <ul className="flex flex-col gap-1 text-sm">
              {result.res.skipped.map((s) => (
                <li key={s.id}>{`${result.names.get(s.id) ?? s.id} — ${skipText(s)}`}</li>
              ))}
            </ul>
            <DialogFooter>
              <Button onClick={() => change(false)}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription>Each gets its own Not interested reply. You can undo for 10 seconds.</DialogDescription>
            </DialogHeader>
            <ul aria-label="Recipients" className="flex max-h-72 flex-col gap-1 overflow-y-auto text-sm">
              {recipients.map((r) => (
                <li key={r.id} className="flex justify-between gap-3">
                  <span className="font-medium text-foreground">{r.name}</span>
                  <span className="truncate text-muted-foreground">{r.email}</span>
                </li>
              ))}
            </ul>
            <DialogFooter>
              <Button variant="outline" onClick={() => change(false)}>
                Cancel
              </Button>
              <Button onClick={() => void confirm()} disabled={pending || recipients.length === 0}>
                {pending && <Spinner data-icon="inline-start" />}
                {title}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
