import { useQuery } from '@tanstack/react-query';
import { Link, useLocation } from 'react-router-dom';
import { Bookmark } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { fetchMailboxes, fetchSavedViews, type InboxView } from '@/lib/api';
import { VIEWS, isInboxView } from '@/lib/inbox';

const ALL = '__all__';

/** ?view=…&mailbox=… (item dropped) on top of the current search. */
export function useViewHref() {
  const { search } = useLocation();
  return (view: InboxView, mailboxId?: string | null) => {
    const params = new URLSearchParams(search);
    params.set('view', view);
    params.delete('item');
    params.delete('draftId');
    if (mailboxId !== undefined) {
      if (mailboxId) params.set('mailbox', mailboxId);
      else params.delete('mailbox');
    }
    return { search: `?${params.toString()}` };
  };
}

export function MailboxSelect({ mailboxId, onChange }: { mailboxId?: string; onChange: (id?: string) => void }) {
  const { data } = useQuery({ queryKey: ['mailboxes'], queryFn: fetchMailboxes, staleTime: 60_000 });
  const mailboxes = data?.data ?? [];
  return (
    <Select value={mailboxId ?? ALL} onValueChange={(v) => onChange(v === ALL ? undefined : v)}>
      <SelectTrigger size="sm" aria-label="Mailbox" className="w-full">
        <SelectValue placeholder="All mailboxes" />
      </SelectTrigger>
      <SelectContent position="popper" align="start">
        <SelectItem value={ALL}>All mailboxes</SelectItem>
        {mailboxes.map((m) => (
          <SelectItem key={m.id} value={m.id}>
            {m.emailAddress}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

interface Props {
  view: InboxView;
  mailboxId?: string;
  counts?: Record<InboxView, number>;
  onMailboxChange: (id?: string) => void;
}

/** Left rail: the five views with counts, mailbox filter, saved views. */
export default function InboxRail({ view, mailboxId, counts, onMailboxChange }: Props) {
  const href = useViewHref();
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
              <Badge variant={v.id === view ? 'default' : 'outline'}>{counts?.[v.id] ?? 0}</Badge>
            </Link>
          </Button>
        ))}
      </nav>
      <MailboxSelect mailboxId={mailboxId} onChange={onMailboxChange} />
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
