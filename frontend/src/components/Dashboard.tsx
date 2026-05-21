import { useQuery } from '@tanstack/react-query';
import {
  fetchCandidates,
  fetchMailboxes,
  fetchDrafts,
  fetchSyncHealth,
  type Candidate,
  type Mailbox,
  type EmailDraft,
  type MailboxSyncHealth,
} from '../lib/api';
import { cn } from '../lib/utils';
import {
  Mail,
  Users,
  Send,
  Clock,
  AlertCircle,
  FileText,
  AlertTriangle,
  Activity,
  Inbox,
  ArrowUpRight,
  ChevronRight,
  Sparkles,
} from 'lucide-react';
import { StatusBadge } from './ui/StatusBadge';

interface Props {
  mailboxId?: string;
  onRefetchMailboxes: () => void;
  onSwitchToDrafts?: () => void;
  onOpenDraftForCandidate?: (candidateId: string) => void;
}

// ---------- Metric ----------

function MetricCard({
  label,
  value,
  icon: Icon,
  accent,
  loading,
  hint,
}: {
  label: string;
  value: number | string;
  icon: React.ComponentType<{ className?: string }>;
  accent: string;
  loading?: boolean;
  hint?: string;
}) {
  return (
    <div className="group relative overflow-hidden rounded-xl border border-white/[0.06] bg-ink-900/60 p-5 transition-all hover:border-white/[0.1]">
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-ink-400">
            {label}
          </p>
          {loading ? (
            <div className="mt-3 h-8 w-16 skeleton" />
          ) : (
            <p className="mt-2 font-display text-3xl font-semibold tabular-nums tracking-tight text-white">
              {value}
            </p>
          )}
          {hint && !loading && (
            <p className="mt-1 text-[11px] text-ink-500">{hint}</p>
          )}
        </div>
        <div
          className={cn(
            'flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg ring-1 ring-inset',
            accent
          )}
        >
          <Icon className="h-4 w-4" />
        </div>
      </div>
    </div>
  );
}

// ---------- Account Pipeline ----------

function AccountCard({
  mailbox,
  candidates,
  drafts,
  onSwitchToDrafts,
}: {
  mailbox: Mailbox;
  candidates: Candidate[];
  drafts: EmailDraft[];
  onSwitchToDrafts?: () => void;
}) {
  const interested = candidates.filter((c) => c.status === 'INTERESTED').length;
  const notInterested = candidates.filter((c) => c.status === 'NOT_INTERESTED').length;
  const replied = candidates.filter((c) => c.status === 'REPLIED').length;
  const pending = candidates.filter(
    (c) => c.status === 'PENDING' || c.status === 'NEUTRAL'
  ).length;

  const pendingDraftCount = drafts.filter((d) => {
    const threadMailbox = d.thread?.mailbox;
    return d.status === 'PENDING' && threadMailbox?.id === mailbox.id;
  }).length;

  const total = candidates.length;

  function Bar({ count, color }: { count: number; color: string }) {
    if (total === 0 || count === 0) return null;
    return (
      <div
        className={cn('h-full', color)}
        style={{ width: `${Math.max(2, (count / total) * 100)}%` }}
        title={`${count}`}
      />
    );
  }

  return (
    <div className="group relative space-y-4 overflow-hidden rounded-xl border border-white/[0.06] bg-ink-900/60 p-5 transition-all hover:border-white/[0.1]">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-accent-500/10 text-accent-300 ring-1 ring-inset ring-accent-500/20">
            <Mail className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="truncate font-mono text-[13px] font-medium text-white">
              {mailbox.emailAddress}
            </p>
            <p className="mt-0.5 text-[11px] text-ink-400">
              {total} candidate{total !== 1 ? 's' : ''} tracked
            </p>
          </div>
        </div>
        {pendingDraftCount > 0 && (
          <button
            onClick={onSwitchToDrafts}
            className="flex flex-shrink-0 items-center gap-1 rounded-full bg-amber-500/10 px-2 py-1 text-[11px] font-medium text-amber-300 ring-1 ring-inset ring-amber-500/20 transition-colors hover:bg-amber-500/15"
          >
            <AlertCircle className="h-3 w-3" />
            {pendingDraftCount}
          </button>
        )}
      </div>

      <div className="space-y-2.5">
        <div className="flex h-1.5 gap-[2px] overflow-hidden rounded-full bg-white/[0.04]">
          <Bar count={interested} color="bg-emerald-400" />
          <Bar count={pending} color="bg-amber-400" />
          <Bar count={replied} color="bg-sky-400" />
          <Bar count={notInterested} color="bg-rose-400" />
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-400">
          {interested > 0 && (
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
              {interested} interested
            </span>
          )}
          {pending > 0 && (
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400" />
              {pending} pending
            </span>
          )}
          {replied > 0 && (
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-sky-400" />
              {replied} replied
            </span>
          )}
          {notInterested > 0 && (
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-rose-400" />
              {notInterested} declined
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- Sync Health ----------

function watchExpiryTone(hours: number | null): string {
  if (hours === null) return 'text-ink-500';
  if (hours < 0) return 'text-rose-300';
  if (hours < 24) return 'text-amber-300';
  return 'text-ink-300';
}

function formatWatchExpiry(h: number | null): string {
  if (h === null) return 'no watch';
  if (h < 0) return `−${Math.abs(Math.round(h))}h`;
  if (h < 1) return `< 1h`;
  if (h < 48) return `${Math.round(h)}h`;
  return `${Math.round(h / 24)}d`;
}

function MailboxHealthSection({
  data,
  loading,
}: {
  data: MailboxSyncHealth[];
  loading: boolean;
}) {
  if (!loading && data.length === 0) return null;
  const anyDrift = data.some((d) => d.lastReconciliationFoundMissing > 0);
  const anyWebhookErrors = data.some((d) => d.webhookErrorsLast24h > 0);

  return (
    <section>
      <SectionHeader
        icon={Activity}
        iconClass="text-emerald-300 bg-emerald-500/10 ring-emerald-500/20"
        title="Mailbox Health"
        right={
          <div className="flex items-center gap-1.5">
            {anyDrift && (
              <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-300 ring-1 ring-inset ring-amber-500/20">
                drift detected
              </span>
            )}
            {anyWebhookErrors && (
              <span className="rounded-full bg-rose-500/10 px-2 py-0.5 text-[11px] font-medium text-rose-300 ring-1 ring-inset ring-rose-500/20">
                webhook errors today
              </span>
            )}
          </div>
        }
      />
      {loading ? (
        <div className="h-24 skeleton rounded-xl" />
      ) : (
        <div className="overflow-hidden rounded-xl border border-white/[0.06] bg-ink-900/60">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-white/[0.06] text-[11px] font-medium uppercase tracking-[0.08em] text-ink-400">
                <th className="px-4 py-2.5 text-left">Mailbox</th>
                <th className="px-4 py-2.5 text-left">Watch expires</th>
                <th className="hidden px-4 py-2.5 text-left sm:table-cell">
                  Msgs / 24h
                </th>
                <th className="hidden px-4 py-2.5 text-left md:table-cell">
                  Last reconciled
                </th>
                <th className="px-4 py-2.5 text-left">Drift</th>
                <th className="px-4 py-2.5 text-left">Webhook errors / 24h</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04]">
              {data.map((row) => {
                const driftTone =
                  row.lastReconciliationFoundMissing > 0
                    ? 'text-amber-300'
                    : 'text-ink-500';
                const webhookErrTone =
                  row.webhookErrorsLast24h > 0
                    ? 'text-rose-300'
                    : 'text-ink-500';
                const recon = row.lastReconciliationAt
                  ? new Date(row.lastReconciliationAt).toLocaleString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })
                  : '—';
                return (
                  <tr
                    key={row.mailboxId}
                    className="transition-colors hover:bg-white/[0.02]"
                  >
                    <td className="px-4 py-2.5">
                      <p className="max-w-[200px] truncate font-mono text-[12px] text-ink-100">
                        {row.emailAddress}
                      </p>
                      {!row.isActive && (
                        <span className="text-[10px] text-rose-300">inactive</span>
                      )}
                    </td>
                    <td
                      className={cn(
                        'px-4 py-2.5 font-mono tabular-nums',
                        watchExpiryTone(row.watchExpiresInHours)
                      )}
                    >
                      {formatWatchExpiry(row.watchExpiresInHours)}
                    </td>
                    <td className="hidden px-4 py-2.5 font-mono tabular-nums text-ink-200 sm:table-cell">
                      {row.messagesLast24h}
                    </td>
                    <td className="hidden px-4 py-2.5 text-ink-400 md:table-cell">
                      {recon}
                    </td>
                    <td
                      className={cn(
                        'px-4 py-2.5 font-mono tabular-nums',
                        driftTone
                      )}
                    >
                      {row.lastReconciliationFoundMissing}
                    </td>
                    <td
                      className={cn(
                        'px-4 py-2.5 font-mono tabular-nums',
                        webhookErrTone
                      )}
                    >
                      {row.webhookErrorsLast24h}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ---------- Section Header ----------

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
    <div className="mb-4 flex items-center justify-between">
      <div className="flex items-center gap-2.5">
        <div
          className={cn(
            'flex h-7 w-7 items-center justify-center rounded-lg ring-1 ring-inset',
            iconClass
          )}
        >
          <Icon className="h-3.5 w-3.5" />
        </div>
        <h2 className="font-display text-[15px] font-semibold tracking-tight text-white">
          {title}
        </h2>
        {count !== undefined && count > 0 && (
          <span className="rounded-full bg-white/[0.05] px-2 py-0.5 text-[11px] font-medium tabular-nums text-ink-300">
            {count}
          </span>
        )}
      </div>
      {right}
    </div>
  );
}

// ---------- Empty States ----------

function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-white/[0.08] bg-ink-900/30 px-6 py-12 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-white/[0.04] text-ink-300 ring-1 ring-inset ring-white/[0.06]">
        <Icon className="h-5 w-5" />
      </div>
      <p className="font-display text-[15px] font-medium text-ink-100">{title}</p>
      <p className="mt-1.5 max-w-xs text-[13px] leading-relaxed text-ink-400">
        {description}
      </p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

// ---------- Main Dashboard ----------

export default function Dashboard({
  mailboxId,
  onSwitchToDrafts,
  onOpenDraftForCandidate,
}: Props) {
  const { data: candidatesData, isLoading: loadingCandidates } = useQuery({
    queryKey: ['candidates', { mailboxId }],
    queryFn: () => fetchCandidates({ mailboxId, limit: 1000 }),
    staleTime: 30_000,
  });

  const { data: draftsData, isLoading: loadingDrafts } = useQuery({
    queryKey: ['drafts'],
    queryFn: () => fetchDrafts({ limit: 1000 }),
    staleTime: 30_000,
  });

  const { data: mailboxesData, isLoading: loadingMailboxes } = useQuery({
    queryKey: ['mailboxes'],
    queryFn: fetchMailboxes,
    staleTime: 60_000,
  });

  const { data: syncHealthData, isLoading: loadingSyncHealth } = useQuery({
    queryKey: ['sync-health'],
    queryFn: fetchSyncHealth,
    staleTime: 60_000,
    retry: false,
  });

  const candidates = candidatesData?.data ?? [];
  const allDrafts = draftsData?.data ?? [];
  const mailboxes = mailboxesData?.data ?? [];

  const total = candidates.length;
  const needReply = candidates.filter((c) => c.status === 'INTERESTED').length;
  const awaitingReply = candidates.filter((c) => {
    const status =
      c.replyStatus ??
      (c.repliedAt ? 'REPLIED' : c.threads?.length ? 'AWAITING_REPLY' : 'NEW');
    return status === 'AWAITING_REPLY';
  }).length;
  const needsReview = candidates.filter((c) => c.status === 'NEEDS_REVIEW').length;
  const pendingDrafts = allDrafts.filter((d) => d.status === 'PENDING').length;

  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const sentThisWeek = allDrafts.filter(
    (d) => d.status === 'SENT' && d.sentAt && new Date(d.sentAt) >= oneWeekAgo
  ).length;

  const mailboxCandidateMap: Record<string, Candidate[]> = {};
  for (const c of candidates) {
    if (!c.mailboxId) continue;
    if (!mailboxCandidateMap[c.mailboxId]) mailboxCandidateMap[c.mailboxId] = [];
    mailboxCandidateMap[c.mailboxId].push(c);
  }

  // Map candidate email -> the candidate's most recent pending draft (if any)
  const draftByCandidateEmail = new Map<string, EmailDraft>();
  for (const d of allDrafts) {
    if (d.status !== 'PENDING') continue;
    const email = d.thread?.candidate?.email;
    if (!email) continue;
    const existing = draftByCandidateEmail.get(email);
    if (!existing || new Date(d.createdAt) > new Date(existing.createdAt)) {
      draftByCandidateEmail.set(email, d);
    }
  }

  const priorityQueue = candidates
    .filter((c) => c.status === 'INTERESTED')
    .sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );

  const mailboxById: Record<string, Mailbox> = {};
  for (const m of mailboxes) {
    mailboxById[m.id] = m;
  }

  const handleCandidateClick = (candidate: Candidate) => {
    if (onOpenDraftForCandidate) {
      onOpenDraftForCandidate(candidate.id);
    } else if (onSwitchToDrafts) {
      onSwitchToDrafts();
    }
  };

  return (
    <div className="space-y-10">
      {/* Hero greeting */}
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-white sm:text-[28px]">
            Pipeline overview
          </h1>
          <p className="mt-1 text-[13.5px] text-ink-400">
            A live view of recruiter mailboxes, candidate replies, and draft activity.
          </p>
        </div>
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <MetricCard
          label="Total"
          value={total}
          icon={Users}
          accent="bg-accent-500/10 text-accent-300 ring-accent-500/20"
          loading={loadingCandidates}
          hint="candidates"
        />
        <MetricCard
          label="Need reply"
          value={needReply}
          icon={AlertCircle}
          accent="bg-emerald-500/10 text-emerald-300 ring-emerald-500/20"
          loading={loadingCandidates}
          hint="interested"
        />
        <MetricCard
          label="Awaiting"
          value={awaitingReply}
          icon={Clock}
          accent="bg-amber-500/10 text-amber-300 ring-amber-500/20"
          loading={loadingCandidates}
          hint="sent, no reply"
        />
        <MetricCard
          label="Review"
          value={needsReview}
          icon={AlertTriangle}
          accent="bg-amber-500/10 text-amber-300 ring-amber-500/20"
          loading={loadingCandidates}
          hint="needs attention"
        />
        <MetricCard
          label="Drafts"
          value={pendingDrafts}
          icon={FileText}
          accent="bg-accent-500/10 text-accent-300 ring-accent-500/20"
          loading={loadingDrafts}
          hint="pending"
        />
        <MetricCard
          label="Sent"
          value={sentThisWeek}
          icon={Send}
          accent="bg-sky-500/10 text-sky-300 ring-sky-500/20"
          loading={loadingDrafts}
          hint="this week"
        />
      </div>

      {/* Account Pipelines */}
      <section>
        <SectionHeader
          icon={Mail}
          iconClass="text-accent-300 bg-accent-500/10 ring-accent-500/20"
          title="Account Pipelines"
          count={mailboxes.length}
        />
        {loadingMailboxes ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-32 skeleton rounded-xl" />
            ))}
          </div>
        ) : mailboxes.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title="No mailboxes connected"
            description="Connect a Gmail account to start syncing candidate replies and generating drafts automatically."
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {mailboxes.map((mailbox) => (
              <AccountCard
                key={mailbox.id}
                mailbox={mailbox}
                candidates={mailboxCandidateMap[mailbox.id] ?? []}
                drafts={allDrafts}
                onSwitchToDrafts={onSwitchToDrafts}
              />
            ))}
          </div>
        )}
      </section>

      <MailboxHealthSection
        data={syncHealthData?.data ?? []}
        loading={loadingSyncHealth}
      />

      {/* Priority queue */}
      <section>
        <SectionHeader
          icon={Clock}
          iconClass="text-amber-300 bg-amber-500/10 ring-amber-500/20"
          title="Candidates Needing Replies"
          count={needReply}
          right={
            pendingDrafts > 0 && (
              <button
                onClick={onSwitchToDrafts}
                className="group flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-medium text-accent-300 transition-colors hover:bg-accent-500/10"
              >
                View all drafts
                <ArrowUpRight className="h-3 w-3 transition-transform group-hover:-translate-y-px group-hover:translate-x-px" />
              </button>
            )
          }
        />

        {loadingCandidates ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 skeleton rounded-xl" />
            ))}
          </div>
        ) : priorityQueue.length === 0 ? (
          <EmptyState
            icon={Sparkles}
            title="All caught up"
            description="No interested candidates need a reply right now. Drafts will appear here as new responses come in."
          />
        ) : (
          <div className="overflow-hidden rounded-xl border border-white/[0.06] bg-ink-900/60">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-white/[0.06] text-[11px] font-medium uppercase tracking-[0.08em] text-ink-400">
                  <th className="px-4 py-3 text-left">Candidate</th>
                  <th className="hidden px-4 py-3 text-left sm:table-cell">
                    Mailbox
                  </th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="hidden px-4 py-3 text-left md:table-cell">
                    Notes
                  </th>
                  <th className="px-4 py-3 text-left">Draft</th>
                  <th className="px-2 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {priorityQueue.map((candidate) => {
                  const mailbox = candidate.mailboxId
                    ? mailboxById[candidate.mailboxId]
                    : undefined;
                  const draft = draftByCandidateEmail.get(candidate.email);
                  const hasDraft = !!draft;
                  return (
                    <tr
                      key={candidate.id}
                      onClick={() => handleCandidateClick(candidate)}
                      className="group cursor-pointer transition-colors hover:bg-white/[0.02]"
                    >
                      <td className="px-4 py-3">
                        <p className="font-medium text-white">
                          {candidate.name}
                        </p>
                        <p className="mt-0.5 text-[12px] text-ink-400">
                          {candidate.email}
                        </p>
                      </td>
                      <td className="hidden px-4 py-3 sm:table-cell">
                        {mailbox ? (
                          <span className="font-mono text-[12px] text-ink-300">
                            {mailbox.emailAddress}
                          </span>
                        ) : (
                          <span className="text-[12px] text-ink-600">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={candidate.status} />
                      </td>
                      <td className="hidden px-4 py-3 md:table-cell">
                        {candidate.notes ? (
                          <span className="line-clamp-2 max-w-xs text-[12px] text-ink-400">
                            {candidate.notes}
                          </span>
                        ) : (
                          <span className="text-[12px] text-ink-600">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {hasDraft ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-500/10 px-2 py-0.5 text-[11px] font-medium text-accent-300 ring-1 ring-inset ring-accent-500/20">
                            <FileText className="h-3 w-3" />
                            Draft ready
                          </span>
                        ) : (
                          <span className="text-[12px] text-ink-600">—</span>
                        )}
                      </td>
                      <td className="px-2 py-3 pr-4">
                        <ChevronRight className="h-4 w-4 text-ink-600 transition-all group-hover:translate-x-0.5 group-hover:text-ink-300" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
