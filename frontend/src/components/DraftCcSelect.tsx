import { useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { fetchDraftCcOptions, type CcOption, type EmailDraft } from '../lib/api';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

// Radix Select can't hold an empty/null value, so "No CC" gets a sentinel.
const NO_CC = '__none__';

/** Hand-off drafts name the CC in the body ("I'm looping in Sofia …"). */
export function mentionsLoopIn(bodyText: string): boolean {
  return /looping in/i.test(bodyText);
}

interface Props {
  draft: EmailDraft;
  onChange: (ccEmail: string | null) => void;
}

/**
 * Who the draft CCs (F4). Defaults to the draft's stored/derived CC; the
 * options exclude the draft's own mailbox owner (server-side, via draftId).
 */
export default function DraftCcSelect({ draft, onChange }: Props) {
  const { data } = useQuery({
    queryKey: ['draft-cc-options', draft.id],
    queryFn: () => fetchDraftCcOptions(draft.id),
    staleTime: 5 * 60 * 1000,
  });

  const current = draft.ccAddress ?? null;
  const options: CcOption[] = data?.data ?? [{ email: null, name: 'No CC', firstName: null }];
  // Keep the current CC selectable even if it's no longer an admin.
  const items =
    current && !options.some((o) => o.email?.toLowerCase() === current.toLowerCase())
      ? [...options, { email: current, name: current, firstName: null }]
      : options;
  const value = current
    ? (items.find((o) => o.email?.toLowerCase() === current.toLowerCase())?.email ?? current)
    : NO_CC;
  const disabled = draft.status === 'SENT' || draft.status === 'DISCARDED';
  const warnNoCc = !current && mentionsLoopIn(draft.bodyText);

  return (
    <div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span id={`cc-label-${draft.id}`}>Cc</span>
        <Select
          value={value}
          disabled={disabled}
          onValueChange={(v) => {
            const next = v === NO_CC ? null : v;
            if (next !== current) onChange(next);
          }}
        >
          <SelectTrigger
            size="sm"
            aria-labelledby={`cc-label-${draft.id}`}
          >
            <SelectValue placeholder={current ?? 'No CC'} />
          </SelectTrigger>
          <SelectContent position="popper" align="start">
            {items.map((o) => (
              <SelectItem key={o.email ?? NO_CC} value={o.email ?? NO_CC}>
                {o.name}
                {o.email && o.name !== o.email ? (
                  <span className="text-xs text-muted-foreground">{o.email}</span>
                ) : null}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {warnNoCc && (
        <p role="status" className="mt-1.5 flex items-center gap-1.5 text-xs text-foreground">
          <AlertTriangle className="size-3.5 shrink-0 text-warning" aria-hidden />
          No one is CC'd, but this email still says you're looping someone in — pick a CC or edit the body.
        </p>
      )}
    </div>
  );
}
