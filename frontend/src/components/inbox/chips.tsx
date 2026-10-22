import { Briefcase, Eye, Pencil } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { ConfidenceLabel, DraftPresenceEntry } from '@/lib/api';
import { replyLabel } from '@/lib/candidates';
import { labelFor } from '@/lib/inbox';

/** Interested / Unsure / Not interested — words only, semantic colour. */
export function LabelChip({
  classification,
  confidenceLabel,
}: {
  classification: string;
  confidenceLabel?: ConfidenceLabel | null;
}) {
  const label = labelFor(classification, confidenceLabel);
  return (
    <Badge variant={label.tone} data-tone={label.tone}>
      {label.text}
    </Badge>
  );
}

/**
 * A Needs-review candidate with no draft yet: the shared status word
 * ("Needs review", lib/candidates replyLabel), as on Candidates.
 */
export function NeedsReviewChip() {
  const label = replyLabel({ status: 'NEEDS_REVIEW', lastInboundAt: null, repliedAt: null });
  return (
    <Badge variant={label.tone} data-tone={label.tone}>
      {label.text}
    </Badge>
  );
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

/** "Sofia editing" / "Sofia viewing" for the first other person on the reply. */
export function PresenceChip({ presence }: { presence: DraftPresenceEntry[] }) {
  const editor = presence.find((p) => p.mode === 'editing') ?? presence[0];
  if (!editor) return null;
  const Icon = editor.mode === 'editing' ? Pencil : Eye;
  return (
    <Badge variant="outline">
      <Icon data-icon="inline-start" />
      {`${firstName(editor.name)} ${editor.mode}`}
    </Badge>
  );
}

export function MailboxChip({ email }: { email: string }) {
  return <Badge variant="secondary">{email.split('@')[0]}</Badge>;
}

const ROLE_MAX_CHARS = 22;

/**
 * The role the candidate replied about. Shared by the Inbox list/panes and
 * reusable by Candidates (R3). Long titles truncate to ~22ch; the full role
 * lives in the tooltip and the accessible name.
 */
export function RoleChip({ role }: { role: string | null | undefined }) {
  const title = role?.trim();
  const truncated = !!title && title.length > ROLE_MAX_CHARS;
  const text = !title ? 'Role unknown' : truncated ? `${title.slice(0, ROLE_MAX_CHARS - 1).trimEnd()}…` : title;
  const tip = !title ? "Claude couldn't detect the role from the outreach" : truncated ? title : null;
  const chip = (
    <Badge
      variant="outline"
      data-testid="role-chip"
      data-role-known={title ? 'true' : 'false'}
      aria-label={title ? `Role: ${title}` : 'Role unknown'}
      // Shrinks before the meta line wraps, so rows keep their height.
      className={cn('min-w-0 shrink justify-start', title ? 'text-foreground' : 'border-dashed text-muted-foreground')}
    >
      <Briefcase data-icon="inline-start" />
      <span className="min-w-0 truncate">{text}</span>
    </Badge>
  );
  if (!tip) return chip;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{chip}</TooltipTrigger>
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  );
}
