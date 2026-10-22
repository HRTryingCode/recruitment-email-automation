import { Briefcase } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { Candidate } from '@/lib/api';
import { replyLabel } from '@/lib/candidates';

/** Interest + reply state as one chip, in words (Interested / Unsure / Not interested …). */
export function ReplyLabelChip({ candidate }: { candidate: Pick<Candidate, 'status' | 'lastInboundAt' | 'repliedAt'> }) {
  const label = replyLabel(candidate);
  return (
    <Badge variant={label.tone} data-testid="reply-label" data-tone={label.tone}>
      {label.text}
    </Badge>
  );
}

/**
 * Role chip for the side panel. Local stand-in: swap for the shared
 * RoleChip from components/inbox/chips.tsx once H7 lands.
 */
export function RoleChip({ role }: { role: string | null | undefined }) {
  return (
    <Badge variant="outline" className={role ? undefined : 'text-muted-foreground'}>
      <Briefcase data-icon="inline-start" />
      {role ?? 'Role not detected'}
    </Badge>
  );
}
