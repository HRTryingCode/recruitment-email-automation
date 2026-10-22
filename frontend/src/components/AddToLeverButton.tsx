import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { fetchLeverMe, type CreateLeverResult, type LeverTarget } from '@/lib/leverApi';
import { prefetchAddToLever } from '@/lib/leverQueries';
import AddToLeverDialog from './AddToLeverDialog';
import { Button } from './ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';

interface Props {
  target: LeverTarget;
  /** Candidate already has a Lever opportunity → "Add to another job". */
  inLever: boolean;
  onCreated?: (result: CreateLeverResult) => void;
  className?: string;
  /** `ghost` for table row actions; `outline` (default) elsewhere. */
  variant?: 'outline' | 'ghost';
}

/**
 * F3 entry point next to a Lever badge. Hidden when Lever isn't configured;
 * shown but inert (with the reason as its tooltip) when the feature flag is
 * off or the recruiter has no Lever user. Hover/focus prefetches the
 * dialog's data (H5) so it usually opens fully filled.
 */
export default function AddToLeverButton({ target, inLever, onCreated, className, variant = 'outline' }: Props) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const { data: me, isError } = useQuery({
    queryKey: ['lever-me'],
    queryFn: fetchLeverMe,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  if (!me || isError || !me.configured) return null;

  const reason = !me.createEnabled
    ? 'Add to Lever is turned off'
    : !me.leverUser
      ? `Your Lever account wasn't found for ${me.appEmail ?? 'your email'}`
      : null;
  const label = inLever ? 'Add to another job' : 'Add to Lever';
  const prefetch = () => {
    if (!reason) prefetchAddToLever(queryClient, target);
  };

  const button = (
    <Button
      type="button"
      size="xs"
      variant={variant}
      aria-disabled={reason ? 'true' : undefined}
      onMouseEnter={prefetch}
      onFocus={prefetch}
      onClick={() => {
        if (!reason) setOpen(true);
      }}
      className={reason ? 'cursor-not-allowed opacity-50' : className}
    >
      <Plus data-icon="inline-start" />
      {label}
    </Button>
  );

  return (
    // Row clicks open the CandidateTable side panel; nothing in here should.
    <span onClick={(e) => e.stopPropagation()} className="inline-flex">
      {reason ? (
        <Tooltip>
          <TooltipTrigger asChild>{button}</TooltipTrigger>
          <TooltipContent>{reason}</TooltipContent>
        </Tooltip>
      ) : (
        button
      )}
      {open && <AddToLeverDialog open onOpenChange={setOpen} target={target} onCreated={onCreated} />}
    </span>
  );
}
