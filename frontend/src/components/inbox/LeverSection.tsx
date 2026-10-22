import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ExternalLink, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import AddToLeverButton from '@/components/AddToLeverButton';
import { refreshCandidateLever, type LeverCandidateFields, type LeverState } from '@/lib/api';
import type { CreateLeverResult } from '@/lib/leverApi';
import { formatAge } from '@/lib/inbox';
import { extractApiErrorMessage, toastError } from '@/lib/toast';

export type LeverFields = Pick<
  LeverCandidateFields,
  'leverState' | 'leverOpportunityId' | 'leverPostingTitle' | 'leverStage' | 'leverArchivedReason' | 'leverCheckedAt' | 'leverError'
>;

const CHIP: Record<LeverState | 'CHECKING', { text: string; variant: 'info' | 'success' | 'secondary' | 'outline' | 'warning' }> = {
  ACTIVE: { text: 'In Lever', variant: 'info' },
  HIRED: { text: 'Hired', variant: 'success' },
  ARCHIVED: { text: 'Archived', variant: 'secondary' },
  NOT_FOUND: { text: 'Not in Lever', variant: 'outline' },
  ERROR: { text: 'Lever unknown', variant: 'warning' },
  CHECKING: { text: 'Checking Lever…', variant: 'outline' },
};

export function leverUrl(opportunityId: string): string {
  return `https://hire.lever.co/candidates/${encodeURIComponent(opportunityId)}`;
}

function checkedLabel(at: string | null | undefined): string | null {
  if (!at) return null;
  const age = formatAge(Date.now() - new Date(at).getTime());
  return age === 'now' ? 'Checked now' : `Checked ${age} ago`;
}

interface Props {
  candidateId: string;
  lever: LeverFields;
  /** Open draft, refreshed after a Lever change. */
  draftId?: string;
}

/**
 * Lever status for the reply pane header (read-only, from the cached
 * Candidate columns): state, job · stage, archived reason, last check with
 * a re-check button, Open in Lever, and Add to Lever / Add to another job.
 */
export default function LeverSection({ candidateId, lever, draftId }: Props) {
  const qc = useQueryClient();
  // The refresh / create responses carry the updated candidate; show it
  // straight away instead of waiting for the inbox and draft to refetch.
  const [override, setOverride] = useState<{ for: string; fields: LeverFields } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const f = override?.for === candidateId ? { ...lever, ...override.fields } : lever;

  const state = f.leverState ?? null;
  const chip = CHIP[state ?? 'CHECKING'];
  const inLever = !!f.leverOpportunityId || state === 'ACTIVE' || state === 'HIRED' || state === 'ARCHIVED';
  const job = [f.leverPostingTitle, f.leverStage].filter(Boolean).join(' · ');
  const checked = checkedLabel(f.leverCheckedAt);

  const adopt = (c: Partial<LeverCandidateFields> | undefined) => {
    if (c) {
      setOverride({
        for: candidateId,
        fields: {
          leverState: c.leverState ?? null,
          leverOpportunityId: c.leverOpportunityId ?? null,
          leverPostingTitle: c.leverPostingTitle ?? null,
          leverStage: c.leverStage ?? null,
          leverArchivedReason: c.leverArchivedReason ?? null,
          leverCheckedAt: c.leverCheckedAt ?? new Date().toISOString(),
          leverError: c.leverError ?? null,
        },
      });
    }
    void qc.invalidateQueries({ queryKey: ['inbox'] });
    if (draftId) void qc.invalidateQueries({ queryKey: ['draft', draftId] });
    void qc.invalidateQueries({ queryKey: ['candidate', candidateId] });
  };

  const refresh = async () => {
    setRefreshing(true);
    try {
      const res = await refreshCandidateLever(candidateId);
      adopt(res.data.candidate);
    } catch (err) {
      toastError("Couldn't refresh Lever", extractApiErrorMessage(err, 'Please try again.'));
    } finally {
      setRefreshing(false);
    }
  };

  const onCreated = (result: CreateLeverResult) => {
    adopt(
      result.candidate ?? {
        leverState: 'ACTIVE',
        leverOpportunityId: result.opportunityId,
        leverPostingTitle: result.postingTitle,
        leverStage: result.stageName,
      }
    );
  };

  return (
    <div role="group" aria-label="Lever" className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
      <Badge variant={chip.variant}>{chip.text}</Badge>
      {job && <span className="font-medium text-foreground">{job}</span>}
      {state === 'ARCHIVED' && f.leverArchivedReason && <span>{f.leverArchivedReason}</span>}
      {state === 'ERROR' && f.leverError && <span>{f.leverError}</span>}
      {checked && <span>{checked}</span>}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button size="icon-xs" variant="ghost" aria-label="Refresh Lever status" disabled={refreshing} onClick={() => void refresh()}>
            {refreshing ? <Spinner /> : <RefreshCw />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>Re-check Lever now</TooltipContent>
      </Tooltip>
      {f.leverOpportunityId && (
        <Button asChild size="xs" variant="link" className="px-0">
          <a href={leverUrl(f.leverOpportunityId)} target="_blank" rel="noopener noreferrer">
            Open in Lever
            <ExternalLink data-icon="inline-end" />
          </a>
        </Button>
      )}
      <AddToLeverButton target={{ candidateId }} inLever={inLever} onCreated={onCreated} />
    </div>
  );
}
