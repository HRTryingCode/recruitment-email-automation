import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fetchLeverMe, type CreateLeverResult, type LeverTarget } from '@/lib/leverApi';
import AddToLeverDialog from './AddToLeverDialog';

interface Props {
  target: LeverTarget;
  /** Candidate already has a Lever opportunity → "Add to another job". */
  inLever: boolean;
  onCreated?: (result: CreateLeverResult) => void;
  className?: string;
}

/**
 * F3 entry point next to a Lever badge. Hidden when Lever isn't configured;
 * shown but inert (with the reason as its tooltip) when the feature flag is
 * off or the recruiter has no Lever user.
 */
export default function AddToLeverButton({ target, inLever, onCreated, className }: Props) {
  const [open, setOpen] = useState(false);
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

  return (
    // Row clicks expand CandidateTable rows; nothing in here should.
    <span onClick={(e) => e.stopPropagation()} className="inline-flex">
      <button
        type="button"
        aria-disabled={reason ? 'true' : undefined}
        title={reason ?? undefined}
        onClick={() => {
          if (!reason) setOpen(true);
        }}
        className={cn(
          'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] font-medium text-accent-700 ring-1 ring-inset ring-accent-500/20 transition-colors hover:bg-accent-500/10 dark:text-accent-300',
          reason && 'cursor-not-allowed opacity-50 hover:bg-transparent',
          className
        )}
      >
        <Plus className="h-3 w-3" />
        {label}
      </button>
      {open && <AddToLeverDialog open onOpenChange={setOpen} target={target} onCreated={onCreated} />}
    </span>
  );
}
