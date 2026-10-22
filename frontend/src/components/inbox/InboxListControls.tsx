import { Briefcase, ListTree } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Toggle } from '@/components/ui/toggle';
import { ROLE_UNKNOWN, ROLE_UNKNOWN_LABEL, SORTS, type InboxSort } from '@/lib/inbox';

interface Props {
  sort: InboxSort;
  onSortChange: (s: InboxSort) => void;
  roles: string[];
  onRolesChange: (roles: string[]) => void;
  /** Items per role in the current view (role null = unknown). */
  roleCounts: Array<{ role: string | null; count: number }>;
  grouped: boolean;
  onGroupedChange: (on: boolean) => void;
}

function RoleOption({ checked, label, count, onSelect }: { checked: boolean; label: string; count?: number; onSelect: () => void }) {
  return (
    <CommandItem value={label} onSelect={onSelect} data-role-checked={checked ? 'true' : 'false'}>
      <Checkbox checked={checked} tabIndex={-1} aria-hidden className="pointer-events-none" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count !== undefined && <span className="text-xs tabular-nums text-muted-foreground">{count}</span>}
    </CommandItem>
  );
}

/** Sort, role filter and group-by-role for the Inbox list header. */
export default function InboxListControls({ sort, onSortChange, roles, onRolesChange, roleCounts, grouped, onGroupedChange }: Props) {
  const known = roleCounts
    .filter((r) => r.role?.trim())
    .map((r) => ({ role: r.role!.trim(), count: r.count }))
    .sort((a, b) => b.count - a.count || a.role.localeCompare(b.role));
  const unknownCount = roleCounts.find((r) => !r.role?.trim())?.count ?? 0;
  // Keep selected roles listed even when the view no longer has them.
  for (const r of roles) if (r !== ROLE_UNKNOWN && !known.some((k) => k.role === r)) known.push({ role: r, count: 0 });
  const toggle = (key: string) => onRolesChange(roles.includes(key) ? roles.filter((r) => r !== key) : [...roles, key]);
  const summary =
    roles.length === 0
      ? 'All roles'
      : roles.length === 1
        ? roles[0] === ROLE_UNKNOWN
          ? ROLE_UNKNOWN_LABEL
          : roles[0]
        : `${roles.length} roles`;

  return (
    <div className="flex flex-wrap items-center gap-1">
      <Select value={sort} onValueChange={(v) => onSortChange(v as InboxSort)}>
        <SelectTrigger size="sm" aria-label="Sort order" className="h-7 gap-1 px-2 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper" align="start">
          {SORTS.map((s) => (
            <SelectItem key={s.id} value={s.id}>
              {s.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            size="sm"
            variant={roles.length ? 'secondary' : 'ghost'}
            aria-label={`Filter by role: ${summary}`}
            className="h-7 max-w-40 gap-1 px-2 text-xs"
          >
            <Briefcase data-icon="inline-start" />
            <span className="truncate">{summary}</span>
            {roles.length > 1 && <Badge variant="outline">{roles.length}</Badge>}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 p-0">
          <Command>
            <CommandInput aria-label="Search roles" placeholder="Search roles…" className="bg-transparent" />
            <CommandList>
              <CommandEmpty>No roles in this view.</CommandEmpty>
              <CommandGroup>
                <RoleOption checked={roles.length === 0} label="All roles" onSelect={() => onRolesChange([])} />
              </CommandGroup>
              <CommandSeparator />
              <CommandGroup>
                {known.map((r) => (
                  <RoleOption key={r.role} checked={roles.includes(r.role)} label={r.role} count={r.count} onSelect={() => toggle(r.role)} />
                ))}
                {(unknownCount > 0 || roles.includes(ROLE_UNKNOWN)) && (
                  <RoleOption
                    checked={roles.includes(ROLE_UNKNOWN)}
                    label={ROLE_UNKNOWN_LABEL}
                    count={unknownCount}
                    onSelect={() => toggle(ROLE_UNKNOWN)}
                  />
                )}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      <Toggle size="sm" pressed={grouped} onPressedChange={onGroupedChange} aria-label="Group by role" className="h-7 min-w-7 px-2">
        <ListTree />
      </Toggle>
    </div>
  );
}
