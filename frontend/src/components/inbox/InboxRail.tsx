import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation } from 'react-router-dom';
import { Bookmark } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { fetchSavedViews, type InboxView } from '@/lib/api';
import { VIEWS, isInboxView } from '@/lib/inbox';
import { cn } from '@/lib/utils';

/** ?view=…&mailboxId=… (item dropped) on top of the current search. */
export function useViewHref() {
  const { search } = useLocation();
  return (view: InboxView, mailboxId?: string | null) => {
    const params = new URLSearchParams(search);
    params.set('view', view);
    params.delete('item');
    params.delete('draftId');
    params.delete('candidateId');
    params.delete('status');
    params.delete('role'); // the role filter belongs to one view
    if (mailboxId !== undefined) {
      if (mailboxId) params.set('mailboxId', mailboxId);
      else params.delete('mailboxId');
    }
    return { search: `?${params.toString()}` };
  };
}

const PULSE_MS = 1500;

/** Views whose count just changed, for a short pulse on their badge. */
function useChangedCounts(counts?: Record<InboxView, number>): Set<InboxView> {
  const prev = useRef(counts);
  const [changed, setChanged] = useState<Set<InboxView>>(new Set());
  useEffect(() => {
    const before = prev.current;
    prev.current = counts;
    if (!before || !counts) return;
    const diff = VIEWS.map((v) => v.id).filter((id) => before[id] !== counts[id]);
    if (diff.length > 0) setChanged(new Set(diff));
  }, [counts]);
  useEffect(() => {
    if (changed.size === 0) return;
    const t = window.setTimeout(() => setChanged(new Set()), PULSE_MS);
    return () => window.clearTimeout(t);
  }, [changed]);
  return changed;
}

interface Props {
  view: InboxView;
  counts?: Record<InboxView, number>;
}

/** Left rail: the five views with counts, then saved views. (Mailbox filter: shell header.) */
export default function InboxRail({ view, counts }: Props) {
  const href = useViewHref();
  const changed = useChangedCounts(counts);
  const { data: savedData } = useQuery({
    queryKey: ['saved-views', 'inbox'],
    queryFn: () => fetchSavedViews('inbox'),
    staleTime: 5 * 60_000,
  });
  const saved = savedData?.data ?? [];

  return (
    <div className="flex flex-col gap-4 p-3">
      <nav aria-label="Inbox views" className="flex flex-col gap-0.5">
        {VIEWS.map((v) => (
          <Button
            key={v.id}
            asChild
            variant={v.id === view ? 'secondary' : 'ghost'}
            size="sm"
            className="w-full justify-between"
          >
            <Link to={href(v.id)} aria-current={v.id === view ? 'page' : undefined}>
              <span>{v.label}</span>
              <Badge
                variant={v.id === view ? 'default' : 'outline'}
                data-changed={changed.has(v.id) ? 'true' : undefined}
                className={cn('tabular-nums transition-shadow duration-500', changed.has(v.id) && 'ring-2 ring-success/60')}
              >
                {counts?.[v.id] ?? 0}
              </Badge>
            </Link>
          </Button>
        ))}
      </nav>
      {saved.length > 0 && (
        <>
          <Separator />
          <nav aria-label="Saved views" className="flex flex-col gap-0.5">
            <p className="px-3 pb-1 text-xs font-medium text-muted-foreground">Saved views</p>
            {saved.map((s) => {
              const f = s.filters as { view?: string; mailboxId?: string };
              const target = isInboxView(f.view) ? f.view : view;
              return (
                <Button key={s.id} asChild variant="ghost" size="sm" className="w-full justify-start">
                  <Link to={href(target, f.mailboxId ?? null)}>
                    <Bookmark data-icon="inline-start" />
                    <span className="truncate">{s.name}</span>
                  </Link>
                </Button>
              );
            })}
          </nav>
        </>
      )}
    </div>
  );
}
