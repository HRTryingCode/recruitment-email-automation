import { useQuery } from '@tanstack/react-query';
import {
  fetchCandidateCounts,
  fetchMailboxes,
  fetchDrafts,
  fetchSyncHealth,
  type Mailbox,
} from '../lib/api';
import { cn } from '../lib/utils';
import { summarizeHealth, mailboxHealthState, type HealthSummary } from '../lib/mailboxHealth';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from './ui/empty';
import { Skeleton } from './ui/skeleton';
import { startGmailReconnect } from '../lib/reconnect';
import {
  Mail,
  Clock,
  AlertCircle,
  FileText,
  AlertTriangle,
  Activity,
  Inbox,
  ChevronRight,
  CheckCircle2,
  RefreshCw,
} from 'lucide-react';

interface Props {
  mailboxId?: string;
  onRefetchMailboxes: () => void;
  onSwitchToDrafts?: () => void;
  onSwitchToCandidates?: (filter?: string) => void;
  /** Unused since R2 retired Quick triage (the Inbox replaces it). */
  onOpenDraftForCandidate?: (candidateId: string) => void;
  /** See onOpenDraftForCandidate. */
  onOpenDraft?: (draftId: string) => void;
}

// ---------- Action pill (the new hero) ----------

function ActionPill({
  count,
  label,
  hint,
  icon: Icon,
  tone,
  loading,
  onClick,
  testId,
}: {
  count: number;
  label: string;
  hint: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: 'accent' | 'amber' | 'emerald';
  loading?: boolean;
  onClick?: () => void;
  testId?: string;
}) {
  const toneRing = {
    accent: 'hover:border-accent-400/50 group-hover:text-accent-500 dark:group-hover:text-accent-200',
    amber: 'hover:border-amber-400/50 group-hover:text-amber-700 dark:group-hover:text-amber-200',
    emerald: 'hover:border-emerald-400/50 group-hover:text-emerald-700 dark:group-hover:text-emerald-200',
  }[tone];
  const toneIcon = {
    accent: 'bg-accent-500/12 text-accent-600 dark:text-accent-300 ring-accent-500/20',
    amber: 'bg-amber-500/12 text-amber-700 dark:text-amber-300 ring-amber-500/20',
    emerald: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 ring-emerald-500/20',
  }[tone];
  const toneNumber = {
    accent: 'text-fg-strong group-hover:text-accent-600 dark:group-hover:text-accent-50',
    amber: 'text-fg-strong group-hover:text-amber-700 dark:group-hover:text-amber-50',
    emerald: 'text-fg-strong group-hover:text-emerald-700 dark:group-hover:text-emerald-50',
  }[tone];

  return (
    <button
      data-testid={testId}
      onClick={onClick}
      className={cn(
        'group relative flex w-full items-center gap-4 overflow-hidden rounded-2xl border border-line bg-surface-raised/70 p-5 text-left transition-all hover:-translate-y-0.5 hover:bg-surface-raised hover:shadow-card-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-400/40',
        toneRing
      )}
    >
      <div
        className={cn(
          'flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl ring-1 ring-inset transition-transform group-hover:scale-105',
          toneIcon
        )}
      >
        <Icon className="h-[18px] w-[18px]" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          {loading ? (
            <Skeleton className="h-8 w-12" />
          ) : (
            <span
              className={cn(
                'font-display text-[34px] font-semibold leading-none tabular-nums tracking-tight transition-colors',
                toneNumber
              )}
            >
              {count}
            </span>
          )}
          <span className="text-[13px] font-medium text-fg-default">{label}</span>
        </div>
        <p className="mt-1.5 text-[11.5px] text-fg-muted">{hint}</p>
      </div>
      <ChevronRight className="h-4 w-4 flex-shrink-0 text-fg-subtle transition-all group-hover:translate-x-0.5 group-hover:text-fg-default" />
    </button>
  );
}

// ---------- Account Pipelines (condensed row) ----------

function ReconnectButton({ emailAddress }: { emailAddress: string }) {
  return (
    <button
      onClick={() => void startGmailReconnect()}
      aria-label={`Reconnect ${emailAddress}`}
      title={`Sign in to Google as ${emailAddress} to restore syncing`}
      className="flex flex-shrink-0 items-center gap-1.5 rounded-md bg-rose-500/10 px-2 py-1 text-[11px] font-medium text-rose-700 ring-1 ring-inset ring-rose-500/20 transition-colors hover:bg-rose-500/15 dark:text-rose-300"
    >
      <RefreshCw className="h-3 w-3" />
      Reconnect
    </button>
  );
}

function AccountRow({
  mailbox,
  candidateCount,
  pendingDraftCount,
  needsReconnect = false,
  onSwitchToDrafts,
}: {
  mailbox: Mailbox;
  candidateCount: number;
  pendingDraftCount: number;
  /** From sync-health: OAuth grant revoked or Gmail watch expired. */
  needsReconnect?: boolean;
  onSwitchToDrafts?: () => void;
}) {
  return (
    <div
      className="group flex items-center gap-3 border-b border-line-soft px-4 py-3 transition-colors last:border-b-0 hover:bg-fg-strong/[0.02]"
    >
      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-accent-500/10 text-accent-600 dark:text-accent-300 ring-1 ring-inset ring-accent-500/20">
        <Mail className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-mono text-[13px] font-medium text-fg-strong">
          {mailbox.emailAddress}
        </p>
        <p className="mt-0.5 text-[11.5px] text-fg-muted">
          <span className="tabular-nums">{candidateCount}</span>{' '}
          candidate{candidateCount !== 1 ? 's' : ''}
          <span className="mx-1.5 text-fg-subtle/40">·</span>
          <span className="tabular-nums">{pendingDraftCount}</span> pending draft{pendingDraftCount !== 1 ? 's' : ''}
          {needsReconnect && (
            <>
              <span className="mx-1.5 text-fg-subtle/40">·</span>
              <span className="font-medium text-rose-700 dark:text-rose-300">Not syncing — reconnect required</span>
            </>
          )}
        </p>
      </div>
      {needsReconnect && <ReconnectButton emailAddress={mailbox.emailAddress} />}
      {pendingDraftCount > 0 && (
        <button
          onClick={onSwitchToDrafts}
          className="flex flex-shrink-0 items-center gap-1.5 rounded-md bg-amber-500/10 px-2 py-1 text-[11px] font-medium text-amber-700 ring-1 ring-inset ring-amber-500/20 transition-colors hover:bg-amber-500/15 dark:text-amber-300"
        >
          <AlertCircle className="h-3 w-3" />
          Review
        </button>
      )}
    </div>
  );
}

// ---------- Mailbox health helpers ----------

function HealthPill({
  summary,
}: {
  summary: HealthSummary;
}) {
  const toneClass = {
    emerald: 'bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 dark:text-emerald-300',
    amber: 'bg-amber-500/10 text-amber-700 ring-amber-500/20 dark:text-amber-300',
    rose: 'bg-rose-500/10 text-rose-700 ring-rose-500/20 dark:text-rose-300',
    neutral: 'bg-fg-strong/[0.04] text-fg-muted ring-fg-strong/[0.06]',
  }[summary.tone];
  const Icon =
    summary.tone === 'emerald'
      ? CheckCircle2
      : summary.tone === 'rose'
        ? AlertCircle
        : summary.tone === 'amber'
          ? AlertTriangle
          : Activity;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-medium ring-1 ring-inset',
        toneClass
      )}
    >
      <Icon className="h-3 w-3" />
      {summary.label}
    </span>
  );
}

function SectionHeader({
  icon: Icon,
  iconClass,
  title,
  count,
  right,
}: {
  icon: React.ComponentType<{ className?: string }>;
  iconClass: string;
  title: string;
  count?: number;
  right?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <div className="flex items-center gap-2.5">
        <div
          className={cn(
            'flex h-7 w-7 items-center justify-center rounded-lg ring-1 ring-inset',
            iconClass
          )}
        >
          <Icon className="h-3.5 w-3.5" />
        </div>
        <h2 className="font-display text-[15px] font-semibold tracking-tight text-fg-strong">
          {title}
        </h2>
        {count !== undefined && count > 0 && (
          <span className="rounded-full bg-fg-strong/[0.06] px-2 py-0.5 text-[11px] font-medium tabular-nums text-fg-muted">
            {count}
          </span>
        )}
      </div>
      {right}
    </div>
  );
}

// ---------- Empty state ----------

function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  compact,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  action?: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <Empty
      className={cn(
        'rounded-xl border border-dashed border-line-strong bg-surface-raised/40 px-6',
        compact ? 'py-8' : 'py-12'
      )}
    >
      <EmptyHeader>
        <EmptyMedia variant="icon" className="bg-fg-strong/[0.04] text-fg-muted">
          <Icon className="size-5" />
        </EmptyMedia>
        <EmptyTitle className="font-display text-[14.5px] font-medium text-fg-strong">
          {title}
        </EmptyTitle>
        <EmptyDescription className="max-w-xs text-[12.5px] leading-relaxed text-fg-muted">
          {description}
        </EmptyDescription>
      </EmptyHeader>
      {action ? <div>{action}</div> : null}
    </Empty>
  );
}

// ---------- Main Dashboard ----------

export default function Dashboard({
  mailboxId,
  onSwitchToDrafts,
  onSwitchToCandidates,
}: Props) {

  // Counts come from the server over every candidate, not a 500-row sample
  // (M18). Keyed under 'candidates' so candidate mutations refresh them.
  const { data: countsData, isLoading: loadingCandidates } = useQuery({
    queryKey: ['candidates', 'counts', { mailboxId }],
    queryFn: () => fetchCandidateCounts({ mailboxId }),
    staleTime: 30_000,
  });

  // Count only (meta.total): replying happens in the Inbox since R2.
  const { data: draftsData, isLoading: loadingDrafts } = useQuery({
    queryKey: ['drafts', 'pending-count', { mailboxId }],
    queryFn: () => fetchDrafts({ status: 'PENDING', limit: 1, mailboxId }),
    staleTime: 30_000,
  });

  const { data: mailboxesData, isLoading: loadingMailboxes } = useQuery({
    queryKey: ['mailboxes'],
    queryFn: fetchMailboxes,
    staleTime: 60_000,
  });

  const { data: syncHealthData, isLoading: loadingSyncHealth, isError: syncHealthError } = useQuery({
    queryKey: ['sync-health'],
    queryFn: fetchSyncHealth,
    staleTime: 60_000,
    retry: 1,
  });

  const counts = countsData?.data;
  const mailboxes = mailboxesData?.data ?? [];
  const syncHealth = syncHealthData?.data ?? [];

  // Role-less candidates (spam/noise) are excluded server-side.
  const awaitingReply = counts?.awaitingReply ?? 0;
  const needsReview = counts?.needsReview ?? 0;
  const pendingDraftCount = draftsData?.meta.total ?? 0;

  const candidateCountByMailbox: Record<string, number> = {};
  const pendingDraftCountByMailbox: Record<string, number> = {};
  for (const row of counts?.byMailbox ?? []) {
    if (!row.mailboxId) continue;
    candidateCountByMailbox[row.mailboxId] = row.candidates;
    pendingDraftCountByMailbox[row.mailboxId] = row.pendingDrafts;
  }

  const healthSummary = summarizeHealth(syncHealth);
  const reconnectMailboxIds = new Set(
    syncHealth.filter((h) => mailboxHealthState(h) === 'reconnect').map((h) => h.mailboxId)
  );

  return (
    <div className="flex flex-col gap-8">
      {/* Hero — greeting + health pill */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-fg-strong sm:text-[28px]">
            Pipeline overview
          </h1>
          <p className="mt-1 text-[13.5px] text-fg-muted">
            Drafts waiting, replies pending, and conversations needing
            attention.
          </p>
        </div>
        {!loadingSyncHealth && (
          syncHealthError
            ? <HealthPill summary={{ tone: 'neutral', label: 'Health data unavailable', unhealthy: false }} />
            : <HealthPill summary={healthSummary} />
        )}
      </div>

      {/* Action pills — the new hero */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <ActionPill
          testId="action-pill-drafts"
          count={pendingDraftCount}
          label="drafts pending"
          hint="Waiting in the Inbox"
          icon={FileText}
          tone="accent"
          loading={loadingDrafts}
          onClick={onSwitchToDrafts}
        />
        <ActionPill
          testId="action-pill-awaiting"
          count={awaitingReply}
          label="awaiting reply"
          hint="Candidate replied — you haven't yet"
          icon={Clock}
          tone="amber"
          loading={loadingCandidates}
          onClick={() => onSwitchToCandidates?.('AWAITING_REPLY')}
        />
        <ActionPill
          testId="action-pill-review"
          count={needsReview}
          label="needs review"
          hint="Low-confidence classifications"
          icon={AlertTriangle}
          tone="emerald"
          loading={loadingCandidates}
          onClick={() => onSwitchToCandidates?.('NEEDS_REVIEW')}
        />
      </div>

      {/* Account Pipelines (condensed) */}
      <section>
        <SectionHeader
          icon={Mail}
          iconClass="text-accent-600 dark:text-accent-300 bg-accent-500/10 ring-accent-500/20"
          title="Account pipelines"
          count={mailboxes.length}
        />
        {loadingMailboxes ? (
          <div className="flex flex-col gap-1 rounded-xl border border-line bg-surface-raised/60">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-14 rounded-none" />
            ))}
          </div>
        ) : mailboxes.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title="No mailboxes connected"
            description="Connect a Gmail account to start syncing candidate replies and generating drafts automatically."
          />
        ) : (
          <div className="overflow-hidden rounded-xl border border-line bg-surface-raised/60">
            {mailboxes.map((mailbox) => (
              <AccountRow
                key={mailbox.id}
                mailbox={mailbox}
                candidateCount={candidateCountByMailbox[mailbox.id] ?? 0}
                pendingDraftCount={pendingDraftCountByMailbox[mailbox.id] ?? 0}
                needsReconnect={reconnectMailboxIds.has(mailbox.id)}
                onSwitchToDrafts={onSwitchToDrafts}
              />
            ))}
          </div>
        )}
      </section>

    </div>
  );
}
