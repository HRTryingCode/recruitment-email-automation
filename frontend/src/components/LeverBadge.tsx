import { Briefcase, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { LeverCandidateFields, LeverLookupIntegration, LeverState } from '@/lib/api';

// Read-only Lever status pill (F2). Colours follow StatusBadge: X-700 text in
// light mode, X-300 in dark; unknown/not-found use the theme-aware fg tokens.
const PILL =
  'inline-flex max-w-full items-center gap-1 truncate rounded-md px-2 py-0.5 text-[11.5px] font-medium ring-1 ring-inset';

const STYLES: Record<LeverState | 'UNKNOWN', string> = {
  ACTIVE: 'bg-violet-500/10 text-violet-700 ring-violet-500/20 dark:text-violet-300',
  HIRED: 'bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 dark:text-emerald-300',
  ARCHIVED: 'bg-fg-strong/[0.05] text-fg-default ring-fg-strong/[0.08]',
  NOT_FOUND: 'bg-fg-strong/[0.03] text-fg-subtle ring-fg-strong/[0.05]',
  ERROR: 'bg-fg-strong/[0.03] text-fg-subtle ring-fg-strong/[0.05]',
  UNKNOWN: 'bg-fg-strong/[0.03] text-fg-subtle ring-fg-strong/[0.05]',
};

export interface LeverBadgeProps {
  state: LeverState | null | undefined;
  opportunityId?: string | null;
  postingTitle?: string | null;
  stage?: string | null;
  archivedReason?: string | null;
  error?: string | null;
  checkedAt?: string | null;
  className?: string;
}

function join(...parts: Array<string | null | undefined>): string {
  return parts.filter((p): p is string => !!p).join(' · ');
}

function describe(p: LeverBadgeProps): { label: string; title: string } {
  const checked = p.checkedAt ? ` (checked ${new Date(p.checkedAt).toLocaleString()})` : '';
  switch (p.state) {
    case 'ACTIVE': {
      const detail = join(p.postingTitle, p.stage);
      return {
        label: p.postingTitle ? detail : join('In Lever', p.stage),
        title: `In Lever: ${detail || 'active opportunity'}${checked}`,
      };
    }
    case 'ARCHIVED':
      return {
        label: join('Archived', p.archivedReason),
        title: `Archived in Lever${p.postingTitle ? ` from ${p.postingTitle}` : ''}${checked}`,
      };
    case 'HIRED':
      return { label: join('Hired', p.postingTitle), title: `Hired in Lever${checked}` };
    case 'NOT_FOUND':
      return { label: 'Not in Lever', title: `No Lever opportunity for this email${checked}` };
    case 'ERROR':
      return {
        label: 'Lever unknown',
        title: `Could not check Lever${p.error ? `: ${p.error}` : ''}${checked}`,
      };
    default:
      return { label: 'Lever unknown', title: 'Lever status not checked yet' };
  }
}

export default function LeverBadge(props: LeverBadgeProps) {
  const { label, title } = describe(props);
  const style = STYLES[props.state ?? 'UNKNOWN'];
  const linked =
    !!props.opportunityId && (props.state === 'ACTIVE' || props.state === 'ARCHIVED' || props.state === 'HIRED');

  if (linked) {
    return (
      <a
        data-testid="lever-badge"
        data-state={props.state}
        href={`https://hire.lever.co/candidates/${encodeURIComponent(props.opportunityId!)}`}
        target="_blank"
        rel="noopener noreferrer"
        title={title}
        aria-label={`${props.state === 'ACTIVE' ? 'In Lever' : label}: open in Lever`}
        onClick={(e) => e.stopPropagation()}
        className={cn(PILL, style, 'hover:underline', props.className)}
      >
        <Briefcase className="h-3 w-3 flex-shrink-0" />
        <span className="truncate">{label}</span>
        <ExternalLink className="h-2.5 w-2.5 flex-shrink-0 opacity-60" />
      </a>
    );
  }
  return (
    <span
      data-testid="lever-badge"
      data-state={props.state ?? 'UNKNOWN'}
      title={title}
      className={cn(PILL, style, props.className)}
    >
      <Briefcase className="h-3 w-3 flex-shrink-0" />
      <span className="truncate">{label}</span>
    </span>
  );
}

/** Badge from the cached columns on a Candidate row (CandidateTable). */
export function CandidateLeverBadge({ candidate }: { candidate: LeverCandidateFields }) {
  return (
    <LeverBadge
      state={candidate.leverState}
      opportunityId={candidate.leverOpportunityId}
      postingTitle={candidate.leverPostingTitle}
      stage={candidate.leverStage}
      archivedReason={candidate.leverArchivedReason}
      error={candidate.leverError}
      checkedAt={candidate.leverCheckedAt}
    />
  );
}

/** Lever slot for F1's <LookupIntegrations>: live status from GET /api/lookup. */
export function LeverLookupPanel({ integration }: { integration: LeverLookupIntegration | undefined }) {
  if (!integration) return null;
  const p = integration.primary;
  const others = integration.opportunities.filter((o) => o.id !== p?.id);
  return (
    <div data-testid="lever-lookup" className="space-y-1.5">
      <LeverBadge
        state={integration.state}
        opportunityId={p?.id}
        postingTitle={p?.postingTitle}
        stage={p?.stage}
        archivedReason={p?.archivedReason}
        error={integration.message}
        checkedAt={integration.checkedAt}
      />
      {others.length > 0 && (
        <ul className="space-y-0.5 text-[12px] text-fg-muted">
          {others.map((o) => (
            <li key={o.id}>
              <a href={o.leverUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">
                {join(o.postingTitle ?? 'No posting', o.archived ? join('Archived', o.archivedReason) : o.stage)}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
