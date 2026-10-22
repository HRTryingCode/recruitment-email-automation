import { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { STATUS_OPTIONS, activeFilterChips, type CandidateFilters } from '@/lib/candidates';

export const SEARCH_DEBOUNCE_MS = 300;

// Radix Select can't use '' as a value; these stand for "no filter".
const ACTIVE = 'ACTIVE';
const ANY = 'ANY';

interface Props {
  filters: CandidateFilters;
  onChange: (next: CandidateFilters) => void;
  total: number | undefined;
}

/**
 * Search + filters. Search narrows the filters (it no longer silently
 * disables them); every active filter is a removable chip.
 */
export default function FilterBar({ filters, onChange, total }: Props) {
  const [input, setInput] = useState(filters.q ?? '');
  const latest = useRef(filters);
  latest.current = filters;

  // Follow the URL (saved view, chip removal, back/forward).
  useEffect(() => {
    setInput(filters.q ?? '');
  }, [filters.q]);

  useEffect(() => {
    const q = input.trim();
    if (q === (latest.current.q ?? '')) return;
    const t = setTimeout(() => onChange({ ...latest.current, q: q || undefined }), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [input, onChange]);

  const chips = activeFilterChips(filters);
  const set = (patch: Partial<CandidateFilters>) => onChange({ ...filters, ...patch });

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <InputGroup className="w-full sm:w-72">
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            aria-label="Search candidates"
            placeholder="Search by name or email…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          {input && (
            <InputGroupAddon align="inline-end">
              <InputGroupButton size="icon-xs" aria-label="Clear search" onClick={() => setInput('')}>
                <X />
              </InputGroupButton>
            </InputGroupAddon>
          )}
        </InputGroup>
        <Select value={filters.status ?? ACTIVE} onValueChange={(v) => set({ status: v === ACTIVE ? undefined : v })}>
          <SelectTrigger size="sm" aria-label="Status filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ACTIVE}>Any active status</SelectItem>
            {STATUS_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filters.reply ?? ANY} onValueChange={(v) => set({ reply: v === ANY ? undefined : (v as 'AWAITING_REPLY') })}>
          <SelectTrigger size="sm" aria-label="Reply filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Any reply state</SelectItem>
            <SelectItem value="AWAITING_REPLY">Awaiting your reply</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filters.lever ?? ANY} onValueChange={(v) => set({ lever: v === ANY ? undefined : (v as 'IN' | 'NOT_IN') })}>
          <SelectTrigger size="sm" aria-label="Lever filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Any Lever status</SelectItem>
            <SelectItem value="IN">In Lever</SelectItem>
            <SelectItem value="NOT_IN">Not in Lever</SelectItem>
          </SelectContent>
        </Select>
        <span className="ml-auto text-xs text-muted-foreground tabular-nums" aria-live="polite">
          {total ?? 0} candidates
        </span>
      </div>
      {chips.length > 0 && (
        <div data-testid="active-filters" className="flex flex-wrap items-center gap-1.5">
          {chips.map((chip) => (
            <Badge key={chip.key} variant="outline" className="h-6 pr-0.5">
              {chip.label}
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={`Remove filter ${chip.label}`}
                onClick={() => {
                  if (chip.key === 'q') setInput('');
                  set({ [chip.key]: undefined });
                }}
                className="size-5"
              >
                <X />
              </Button>
            </Badge>
          ))}
          <Button
            size="xs"
            variant="link"
            onClick={() => {
              setInput('');
              onChange({ sort: filters.sort, dir: filters.dir });
            }}
          >
            Clear filters
          </Button>
        </div>
      )}
    </div>
  );
}
