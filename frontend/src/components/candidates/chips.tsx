import { MailboxChip } from '@/components/inbox/chips';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { Candidate } from '@/lib/api';
import { replyLabel } from '@/lib/candidates';

/** The Inbox's role chip (H7), shared with the side panel. */
export { RoleChip } from '@/components/inbox/chips';

/** The Inbox's mailbox chip (full address); the tooltip repeats it when the column clips it. */
export function CandidateMailboxChip({ email }: { email: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span data-testid="mailbox-chip" aria-label={`Mailbox: ${email}`} className="inline-flex min-w-0 max-w-full">
          <MailboxChip email={email} />
        </span>
      </TooltipTrigger>
      <TooltipContent>{email}</TooltipContent>
    </Tooltip>
  );
}

/** Interest + reply state as one chip, in words (Interested / Unsure / Not interested …). */
export function ReplyLabelChip({ candidate }: { candidate: Pick<Candidate, 'status' | 'lastInboundAt' | 'repliedAt'> }) {
  const label = replyLabel(candidate);
  return (
    <Badge variant={label.tone} data-testid="reply-label" data-tone={label.tone}>
      {label.text}
    </Badge>
  );
}
