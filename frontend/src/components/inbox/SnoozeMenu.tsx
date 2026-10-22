import { useState } from 'react';
import { AlarmClock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Kbd } from '@/components/ui/kbd';
import { Label } from '@/components/ui/label';
import { customSnooze, snoozePresets } from '@/lib/inbox';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (until: Date) => void;
  disabled?: boolean;
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Snooze presets (ET) plus a custom date (9am ET that day, ≤ 30 days). */
export default function SnoozeMenu({ open, onOpenChange, onSelect, disabled }: Props) {
  const [customOpen, setCustomOpen] = useState(false);
  const [date, setDate] = useState('');
  const now = new Date();
  const presets = snoozePresets(now);
  const min = ymd(new Date(now.getTime() + 86400_000));
  const max = ymd(new Date(now.getTime() + 29 * 86400_000));

  return (
    <>
      <DropdownMenu open={open} onOpenChange={onOpenChange}>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" disabled={disabled}>
            <AlarmClock data-icon="inline-start" />
            Snooze
            <Kbd className="max-sm:hidden">S</Kbd>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {presets.map((p) => (
            <DropdownMenuItem key={p.key} onSelect={() => onSelect(p.until)}>
              {p.label}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setCustomOpen(true)}>Custom date…</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={customOpen} onOpenChange={setCustomOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Snooze until</DialogTitle>
            <DialogDescription>The reply comes back at 9am ET on this day.</DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!date) return;
              setCustomOpen(false);
              onSelect(customSnooze(date));
              setDate('');
            }}
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="snooze-date">Date</Label>
              <Input id="snooze-date" type="date" min={min} max={max} value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={!date}>
                Snooze
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
