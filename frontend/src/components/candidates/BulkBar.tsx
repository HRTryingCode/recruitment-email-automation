import { EyeOff, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { Candidate } from '@/lib/api';
import { SETTABLE_STATUSES } from '@/lib/candidates';

interface Props {
  count: number;
  busy: boolean;
  onStatus: (status: Candidate['status']) => void;
  onIgnore: () => void;
  onClear: () => void;
}

/** Shown while rows are checked: change status or Ignore in bulk (Add to Lever stays per row). */
export default function BulkBar({ count, busy, onStatus, onIgnore, onClear }: Props) {
  return (
    <div role="toolbar" aria-label="Bulk actions" className="flex flex-wrap items-center gap-2 border-b border-border bg-muted px-3 py-2">
      <span className="text-sm font-medium tabular-nums">{count} selected</span>
      {/* Uncontrolled value: the trigger always reads "Change status…". */}
      <Select value="" onValueChange={(v) => onStatus(v as Candidate['status'])} disabled={busy}>
        <SelectTrigger size="sm" aria-label="Change status of selected">
          <SelectValue placeholder="Change status…" />
        </SelectTrigger>
        <SelectContent>
          {SETTABLE_STATUSES.map((s) => (
            <SelectItem key={s.value} value={s.value}>
              {s.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button size="sm" variant="outline" onClick={onIgnore} disabled={busy}>
        <EyeOff data-icon="inline-start" />
        Ignore
      </Button>
      <Button size="sm" variant="ghost" onClick={onClear} className="ml-auto">
        <X data-icon="inline-start" />
        Clear selection
      </Button>
    </div>
  );
}
