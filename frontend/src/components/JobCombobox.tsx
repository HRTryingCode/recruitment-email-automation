import { useMemo, useState } from 'react';
import type { LeverPosting } from '@/lib/leverApi';
import { cn } from '@/lib/utils';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from './ui/command';
import { Popover, PopoverTrigger } from './ui/popover';
import { ComboboxContent, ComboboxTrigger } from './ui/combobox';
import { Badge } from './ui/badge';

interface Props {
  postings: LeverPosting[];
  value: string | null;
  onChange: (id: string) => void;
  suggestedId: string | null;
  invalid?: boolean;
}

/** Every typed word must appear in the job's title/team/location (cmdk's default is fuzzy, so "ops" matched "Product Designer"). */
export function jobFilter(value: string, search: string): number {
  const hay = value.toLowerCase();
  return search.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w)) ? 1 : 0;
}

function meta(p: LeverPosting): string {
  return [p.location, p.state === 'internal' ? 'internal' : null].filter(Boolean).join(' · ');
}

/** H3: one searchable Job field — suggested job first, the rest grouped by team. */
export default function JobCombobox({ postings, value, onChange, suggestedId, invalid }: Props) {
  const [open, setOpen] = useState(false);
  const selected = postings.find((p) => p.id === value) ?? null;

  const { suggested, groups } = useMemo(() => {
    const byTitle = [...postings].sort((a, b) => a.title.localeCompare(b.title));
    const suggested = byTitle.find((p) => p.id === suggestedId) ?? null;
    const teams = new Map<string, LeverPosting[]>();
    for (const p of byTitle) {
      if (p === suggested) continue;
      const team = p.team ?? 'No team';
      teams.set(team, [...(teams.get(team) ?? []), p]);
    }
    return { suggested, groups: [...teams.entries()].sort(([a], [b]) => a.localeCompare(b)) };
  }, [postings, suggestedId]);

  const item = (p: LeverPosting) => (
    <CommandItem
      key={p.id}
      // cmdk filters on `value`; include team and location so "nyc" or "eng" match.
      value={`${p.title} ${p.team ?? ''} ${p.location ?? ''} ${p.id}`}
      data-checked={p.id === value}
      onSelect={() => {
        onChange(p.id);
        setOpen(false);
      }}
    >
      <div className="flex min-w-0 flex-col">
        <span className="flex items-center gap-1.5 truncate">
          {p.title}
          {p.id === suggestedId && <Badge variant="secondary">Suggested</Badge>}
        </span>
        {meta(p) && <span className="truncate text-xs font-normal text-muted-foreground">{meta(p)}</span>}
      </div>
    </CommandItem>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {/* Radix sets aria-expanded / aria-controls on the trigger. */}
        <ComboboxTrigger aria-label="Job" aria-invalid={invalid || undefined} className={cn(!selected && 'text-muted-foreground')}>
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate">{selected?.title ?? 'Pick a job'}</span>
            {selected && selected.id === suggestedId && <Badge variant="secondary">Suggested</Badge>}
            {selected && meta(selected) && <span className="truncate text-xs text-muted-foreground">{meta(selected)}</span>}
          </span>
        </ComboboxTrigger>
      </PopoverTrigger>
      <ComboboxContent align="start">
        <Command filter={jobFilter}>
          {/* bg-transparent: the raw cmdk input otherwise paints the UA white box in light mode. */}
          <CommandInput aria-label="Search jobs" placeholder="Search jobs…" className="bg-transparent" />
          <CommandList>
            <CommandEmpty>No open jobs match</CommandEmpty>
            {suggested && <CommandGroup heading="Suggested">{item(suggested)}</CommandGroup>}
            {groups.map(([team, list]) => (
              <CommandGroup key={team} heading={team}>
                {list.map(item)}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </ComboboxContent>
    </Popover>
  );
}
