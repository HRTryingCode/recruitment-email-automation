import { Badge } from '@/components/ui/badge';
import type { Candidate } from '@/lib/api';
import { replyLabel } from '@/lib/candidates';

/** The Inbox's role chip (H7), shared with the side panel. */
export { RoleChip } from '@/components/inbox/chips';

/** Interest + reply state as one chip, in words (Interested / Unsure / Not interested …). */
export function ReplyLabelChip({ candidate }: { candidate: Pick<Candidate, 'status' | 'lastInboundAt' | 'repliedAt'> }) {
  const label = replyLabel(candidate);
  return (
    <Badge variant={label.tone} data-testid="reply-label" data-tone={label.tone}>
      {label.text}
    </Badge>
  );
}
