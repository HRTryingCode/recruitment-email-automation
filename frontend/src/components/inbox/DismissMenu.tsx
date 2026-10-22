import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Kbd } from '@/components/ui/kbd';
import type { DismissReason } from '@/lib/api';

export const DISMISS_REASONS: Array<{ reason: DismissReason; label: string }> = [
  { reason: 'wrong_label', label: 'Wrong label' },
  { reason: 'spam', label: 'Spam' },
  { reason: 'already_handled', label: 'Already handled' },
  { reason: 'not_needed', label: 'Not needed' },
  { reason: 'other', label: 'Other' },
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (reason: DismissReason) => void;
  disabled?: boolean;
}

/** Dismiss = no reply goes out; the reason is recorded. */
export default function DismissMenu({ open, onOpenChange, onSelect, disabled }: Props) {
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" disabled={disabled}>
          <X data-icon="inline-start" />
          Dismiss
          <Kbd className="max-sm:hidden">D</Kbd>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>Why dismiss?</DropdownMenuLabel>
        {DISMISS_REASONS.map((r) => (
          <DropdownMenuItem key={r.reason} onSelect={() => onSelect(r.reason)}>
            {r.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
