import { CircleX, Eye, EyeOff, MoreHorizontal, PenLine, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { Candidate } from '@/lib/api';
import { SETTABLE_STATUSES } from '@/lib/candidates';

export interface CandidateMenuHandlers {
  onStatus: (status: Candidate['status']) => void;
  onTriage: (decision: 'INTERESTED' | 'NOT_INTERESTED') => void;
  onClearReplied: () => void;
  onIgnore: () => void;
  onRestore: () => void;
}

/** ⋯ menu: change status, NEEDS_REVIEW triage, clear "replied", Ignore / Restore. */
export default function CandidateMenu({
  candidate,
  busy,
  ...h
}: { candidate: Candidate; busy?: boolean } & CandidateMenuHandlers) {
  const replied = (candidate.replyStatus ?? (candidate.repliedAt ? 'REPLIED' : null)) === 'REPLIED';
  const ignored = candidate.status === 'IGNORED';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon-xs" variant="ghost" aria-label={`More actions for ${candidate.name}`} disabled={busy}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {candidate.status === 'NEEDS_REVIEW' && (
          <>
            <DropdownMenuItem onSelect={() => h.onTriage('INTERESTED')}>
              <PenLine />
              Interested + draft reply
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => h.onTriage('NOT_INTERESTED')}>
              <CircleX />
              Not interested
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        {!ignored && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Change status</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup
                value={candidate.status}
                onValueChange={(v) => v !== candidate.status && h.onStatus(v as Candidate['status'])}
              >
                {SETTABLE_STATUSES.map((s) => (
                  <DropdownMenuRadioItem key={s.value} value={s.value}>
                    {s.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}
        {replied && (
          <DropdownMenuItem onSelect={h.onClearReplied}>
            <RotateCcw />
            Mark as awaiting reply
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        {ignored ? (
          <DropdownMenuItem onSelect={h.onRestore}>
            <Eye />
            Restore
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem variant="destructive" onSelect={h.onIgnore}>
            <EyeOff />
            Ignore…
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
