import { Briefcase, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { LeverCandidateFields, LeverLookupIntegration, LeverState } from '@/lib/api';

// Read-only Lever status pill (F2). Colours follow StatusBadge: X-700 text in
// light mode, X-300 in dark; checking/unknown/not-found use the theme-aware
// fg tokens. "Lever unknown" is reserved for real ERROR rows; never-checked
// rows read "Checking Lever…" (H1) while the table/cron fill them in.
const PILL =
  'inline-flex max-w-full items-center gap-1 truncate rounded-md px-2 py-0.5 text-[11.5px] font-medium ring-1 ring-inset';

const STYLES: Record<LeverState | 'CHECKING', string> = {
  ACTIVE: 'bg-violet-500/10 text-violet-700 ring-violet-500/20 dark:text-violet-300',
  HIRED: 'bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 dark:text-emerald-300',
  ARCHIVED: 'bg-fg-strong/[0.05] text-fg-default ring-fg-strong/[0.08]',
  NOT_FOUND: 'bg-fg-strong/[0.03] text-fg-subtle ring-fg-strong/[0.05]',
  ERROR: 'bg-fg-strong/[0.03] text-fg-subtle ring-fg-strong/[0.05]',
  CHECKING: 'bg-fg-strong/[0.03] text-fg-subtle ring-fg-strong/[0.05]',
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

/** Human reason for an ERROR row; the raw code stays in parentheses. */
function errorReason(code: string | null | undefined): string {
  if (!code) return '';
  const human =
    code === 'unconfigured'
      ? 'Lever API key not configured'
      : code === 'timeout'
        ? 'Lever timed out'
        : code === 'network'
          ? 'network error reaching Lever'
          : code === 'http_401' || code === 'http_403'
            ? 'Lever rejected the API key'
            : code === 'http_429'
              ? 'Lever rate limit'
              : /^http_5\d\d$/.test(code)
                ? 'Lever server error'
                : null;
  return human ? `: ${human} (${code})` : `: ${code}`;
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
        title: `Could not check Lever${errorReason(p.error)}${checked}`,
      };
    default:
      return { label: 'Checking Lever…', title: 'Lever status not checked yet — checking now' };
  }
}

export default function LeverBadge(props: LeverBadgeProps) {
  const { label, title } = describe(props);
  const style = STYLES[props.state ?? 'CHECKING'];
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
      data-state={props.state ?? 'CHECKING'}
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
