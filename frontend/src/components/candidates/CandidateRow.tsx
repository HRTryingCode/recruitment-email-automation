import { Copy, PanelRightOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { TableCell, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import AddToLeverButton from '@/components/AddToLeverButton';
import { CandidateLeverBadge } from '@/components/LeverBadge';
import type { Candidate } from '@/lib/api';
import { lastActivity } from '@/lib/candidates';
import { cn, formatTimeAgo } from '@/lib/utils';
import CandidateMenu, { type CandidateMenuHandlers } from './CandidateMenu';
import { ReplyLabelChip } from './chips';

interface Props extends CandidateMenuHandlers {
  candidate: Candidate;
  /** Keyboard cursor (↑/↓) is on this row. */
  active: boolean;
  selected: boolean;
  busy: boolean;
  onSelect: (checked: boolean) => void;
  onOpen: () => void;
  onCopy: () => void;
  onHover: () => void;
}

/** Elements whose own click shouldn't also open the side panel. */
const INTERACTIVE = 'button,a,input,[role=checkbox],[role=menuitem],[role=menu]';

/**
 * One ~40px row: checkbox · candidate (sticky) · reply label · Lever · role
 * · mailbox · last activity · actions (on hover/focus/cursor). Two chips max.
 */
export default function CandidateRow({ candidate: c, active, selected, busy, onSelect, onOpen, onCopy, onHover, ...menu }: Props) {
  const activity = lastActivity(c);
  const showLeverAdd = !!c.leverState && c.leverState !== 'ERROR';
  return (
    <TableRow
      data-testid="candidate-row"
      data-candidate-id={c.id}
      data-active={active || undefined}
      data-state={selected ? 'selected' : undefined}
      aria-selected={selected}
      onMouseEnter={onHover}
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest(INTERACTIVE)) onOpen();
      }}
      // Opaque backgrounds so the sticky first column can inherit them.
      className="group cursor-pointer bg-background hover:bg-muted has-[[aria-expanded=true]]:bg-muted data-[active=true]:bg-muted data-[state=selected]:bg-muted"
    >
      <TableCell className="w-10 py-0.5 pl-3">
        <Checkbox checked={selected} onCheckedChange={(v) => onSelect(v === true)} aria-label={`Select ${c.name}`} />
      </TableCell>
      <TableCell className="sticky left-0 max-w-64 bg-inherit py-0.5">
        <div className="flex min-w-0 flex-col">
          <Button
            variant="link"
            size="xs"
            onClick={onOpen}
            className="h-5 justify-start truncate px-0 text-sm font-medium text-foreground"
          >
            {c.name}
          </Button>
          <span className="truncate text-xs text-muted-foreground">{c.email}</span>
        </div>
      </TableCell>
      <TableCell className="py-0.5">
        <ReplyLabelChip candidate={c} />
      </TableCell>
      <TableCell className="hidden max-w-56 py-0.5 md:table-cell">
        <CandidateLeverBadge candidate={c} />
      </TableCell>
      <TableCell className="hidden max-w-40 truncate py-0.5 text-muted-foreground xl:table-cell">
        {c.role ?? '—'}
      </TableCell>
      <TableCell className="hidden max-w-40 truncate py-0.5 text-muted-foreground xl:table-cell">
        {c.mailbox?.emailAddress ?? '—'}
      </TableCell>
      <TableCell className="hidden py-0.5 text-muted-foreground tabular-nums sm:table-cell">
        <span>{formatTimeAgo(activity.at)}</span>
        {activity.who && <span className="hidden text-xs sm:inline">{` · ${activity.who}`}</span>}
      </TableCell>
      {/* Zero-width cell: the actions overlay the row's right edge (in the
          row's own background) instead of widening the table. */}
      <TableCell className="relative w-0 bg-inherit p-0">
        <div
          data-testid="row-actions"
          className={cn(
            'absolute inset-y-0 right-0 flex items-center gap-1 bg-inherit pr-3 pl-2 transition-opacity md:opacity-0',
            'md:group-hover:opacity-100 md:group-focus-within:opacity-100 md:group-data-[active=true]:opacity-100 md:group-has-[[aria-expanded=true]]:opacity-100'
          )}
        >
          <Button size="xs" variant="ghost" onClick={onOpen} className="hidden md:inline-flex">
            <PanelRightOpen data-icon="inline-start" />
            Open
          </Button>
          {showLeverAdd && (
            <span className="hidden md:inline-flex">
              <AddToLeverButton variant="ghost" target={{ candidateId: c.id }} inLever={c.leverState !== 'NOT_FOUND'} />
            </span>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="icon-xs" variant="ghost" aria-label={`Copy ${c.email}`} onClick={onCopy} className="hidden md:inline-flex">
                <Copy />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Copy email</TooltipContent>
          </Tooltip>
          <CandidateMenu candidate={c} busy={busy} {...menu} />
        </div>
      </TableCell>
    </TableRow>
  );
}
