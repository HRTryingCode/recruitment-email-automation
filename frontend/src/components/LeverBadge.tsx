import { Briefcase, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { LeverCandidateFields, LeverLookupIntegration, LeverState } from '@/lib/api';
import { Badge } from './ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';

// Read-only Lever status chip (F2) — same colours as the Inbox Lever section
// (components/lever/LeverSection). Never-checked rows read "Checking Lever…"
// (H1) while the table/cron fill them in; "Lever unknown" is real ERRORs only.
type Variant = 'info' | 'success' | 'secondary' | 'outline' | 'warning';
const VARIANT: Record<LeverState | 'CHECKING', Variant> = {
  ACTIVE: 'info',
  HIRED: 'success',
  ARCHIVED: 'secondary',
  NOT_FOUND: 'outline',
  ERROR: 'warning',
  CHECKING: 'outline',
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
  const state = props.state ?? 'CHECKING';
  const linked =
    !!props.opportunityId && (props.state === 'ACTIVE' || props.state === 'ARCHIVED' || props.state === 'HIRED');
  const chip = (
    <Badge
      data-testid="lever-badge"
      data-state={state}
      variant={VARIANT[state]}
      className={cn('max-w-full', state === 'CHECKING' && 'text-muted-foreground', props.className)}
    >
      <Briefcase data-icon="inline-start" />
      <span className="truncate">{label}</span>
      {linked && <ExternalLink data-icon="inline-end" />}
    </Badge>
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {linked ? (
          <a
            href={`https://hire.lever.co/candidates/${encodeURIComponent(props.opportunityId!)}`}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${props.state === 'ACTIVE' ? 'In Lever' : label}: open in Lever`}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex min-w-0 max-w-full hover:underline"
          >
            {chip}
          </a>
        ) : (
          <span className="inline-flex min-w-0 max-w-full">{chip}</span>
        )}
      </TooltipTrigger>
      <TooltipContent>{title}</TooltipContent>
    </Tooltip>
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
        <ul className="space-y-0.5 text-xs text-muted-foreground">
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
