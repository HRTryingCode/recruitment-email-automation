import { useEffect, useId, useRef } from 'react';
import { AlertCircle, Inbox as InboxIcon, Send } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import type { InboxItem, InboxView } from '@/lib/api';
import { VIEWS, formatAge, itemKey, type RoleGroup } from '@/lib/inbox';
import { LabelChip, MailboxChip, PresenceChip, RoleChip } from './chips';

export { itemKey } from '@/lib/inbox';

function initials(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .map((s) => s[0])
      .slice(0, 2)
      .join('')
      .toUpperCase() || '?'
  );
}

function Row({
  item,
  selected,
  focused,
  highlighted,
  checkable,
  checked,
  onOpen,
  onCheck,
}: {
  item: InboxItem;
  selected: boolean;
  focused: boolean;
  highlighted: boolean;
  checkable: boolean;
  checked: boolean;
  onOpen: () => void;
  onCheck: (checked: boolean) => void;
}) {
  const ref = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    if (focused || highlighted) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [focused, highlighted]);
  const name = item.candidate?.name ?? 'Unknown candidate';
  const preview = item.draft?.preview ?? 'No draft yet — needs a decision';
  return (
    <li ref={ref} className="flex items-center gap-1 px-2">
      {checkable && (
        <Checkbox
          aria-label={`Select ${name}`}
          checked={checked}
          onCheckedChange={(v) => onCheck(v === true)}
          className="ml-1"
        />
      )}
      <Button
        variant={selected ? 'secondary' : 'ghost'}
        size="row"
        onClick={onOpen}
        aria-current={selected ? 'true' : undefined}
        data-focused={focused ? 'true' : undefined}
        data-highlighted={highlighted ? 'true' : undefined}
        className="transition-colors duration-700 data-[focused=true]:ring-2 data-[focused=true]:ring-ring/40 data-[highlighted=true]:bg-success/10 data-[highlighted=true]:ring-2 data-[highlighted=true]:ring-success/40"
      >
        <Avatar size="sm">
          <AvatarFallback>{initials(name)}</AvatarFallback>
        </Avatar>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className="truncate font-medium text-foreground">{name}</span>
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{formatAge(item.ageMs)}</span>
          </span>
          <span className="flex min-w-0 items-center gap-1 overflow-hidden">
            <RoleChip role={item.candidate?.role} />
            {item.mailbox && <MailboxChip email={item.mailbox.emailAddress} />}
            {item.draft ? (
              <LabelChip classification={item.draft.classification} confidenceLabel={item.draft.confidenceLabel} />
            ) : (
              <LabelChip classification="NEUTRAL" />
            )}
            <PresenceChip presence={item.presence} />
          </span>
          <span className="truncate text-xs font-normal text-muted-foreground">{preview}</span>
        </span>
      </Button>
    </li>
  );
}

interface Props {
  view: InboxView;
  items: InboxItem[];
  total?: number;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  selectedKey?: string;
  focusedKey?: string;
  /** Briefly marks a row that just arrived in this view (H8). */
  highlightKey?: string;
  onOpen: (key: string) => void;
  /** Batch selection (Not interested view only). */
  checked: Set<string>;
  onCheckedChange: (next: Set<string>) => void;
  onBatchSend: () => void;
  header?: React.ReactNode;
  /** Sort / role filter / group controls, shown beside the title. */
  controls?: React.ReactNode;
  /** Group by role: sections in display order (items as in `items`). */
  groups?: RoleGroup[];
  /** A role filter is on: empty means "no replies for this role". */
  roleFiltered?: boolean;
}

export default function InboxList({
  view,
  items,
  total,
  loading,
  error,
  onRetry,
  selectedKey,
  focusedKey,
  highlightKey,
  onOpen,
  checked,
  onCheckedChange,
  onBatchSend,
  header,
  controls,
  groups,
  roleFiltered,
}: Props) {
  const meta = VIEWS.find((v) => v.id === view)!;
  const groupId = useId();
  const batchable = view === 'not_interested';
  const draftIds = items.filter((i) => i.kind === 'draft').map((i) => i.id);
  const allChecked = draftIds.length > 0 && draftIds.every((id) => checked.has(id));

  const renderRow = (item: InboxItem) => {
    const key = itemKey(item);
    return (
      <Row
        key={key}
        item={item}
        selected={key === selectedKey}
        focused={key === focusedKey}
        highlighted={key === highlightKey}
        checkable={batchable && item.kind === 'draft'}
        checked={checked.has(item.id)}
        onOpen={() => onOpen(key)}
        onCheck={(v) => {
          const next = new Set(checked);
          if (v) next.add(item.id);
          else next.delete(item.id);
          onCheckedChange(next);
        }}
      />
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-col gap-2 border-b border-border p-3">
        {header}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {batchable && draftIds.length > 0 && (
              <Checkbox
                aria-label="Select all"
                checked={allChecked}
                onCheckedChange={(v) => onCheckedChange(v === true ? new Set(draftIds) : new Set())}
              />
            )}
            <h2 className="font-heading text-sm font-semibold text-foreground">{meta.label}</h2>
            <span className="text-xs tabular-nums text-muted-foreground">{total ?? items.length}</span>
          </div>
          {controls}
          {batchable && checked.size > 0 && (
            <Button size="sm" onClick={onBatchSend}>
              <Send data-icon="inline-start" />
              {`Send ${checked.size} ${checked.size === 1 ? 'reply' : 'replies'}`}
            </Button>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-2">
        {loading ? (
          <div aria-label="Loading replies" className="flex flex-col gap-2 px-3">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : error ? (
          <div className="px-3">
            <Alert variant="destructive">
              <AlertCircle />
              <AlertTitle>Couldn't load the inbox</AlertTitle>
              <AlertDescription>
                <Button size="sm" variant="outline" onClick={onRetry}>
                  Retry
                </Button>
              </AlertDescription>
            </Alert>
          </div>
        ) : items.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <InboxIcon />
              </EmptyMedia>
              <EmptyTitle>{roleFiltered ? 'No replies for this role' : meta.empty}</EmptyTitle>
              <EmptyDescription>
                {roleFiltered ? 'Try another role, or show all roles.' : meta.hint}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : groups ? (
          <ul aria-label={`${meta.label} replies`} className="flex flex-col gap-2">
            {groups.map((g, i) => (
              // Header after its rows in the DOM so it paints over them when
              // stuck (rows hold positioned avatars); order-first shows it on top.
              <li key={g.key} aria-labelledby={`${groupId}-${i}`} className="flex flex-col">
                <ul className="flex flex-col gap-0.5">{g.items.map(renderRow)}</ul>
                <h3
                  id={`${groupId}-${i}`}
                  className="sticky top-0 order-first flex items-center gap-2 bg-background px-4 py-1.5 text-xs font-semibold text-muted-foreground"
                >
                  <span className="truncate">{g.label}</span>
                  <span className="tabular-nums font-normal">{g.count}</span>
                </h3>
              </li>
            ))}
          </ul>
        ) : (
          <ul aria-label={`${meta.label} replies`} className="flex flex-col gap-0.5">
            {items.map(renderRow)}
          </ul>
        )}
      </div>
    </div>
  );
}
