import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from './ui/alert-dialog';
import {
  fetchCandidates,
  fetchMessages,
  generateDraftForThread,
  updateCandidate,
  clearRepliedAt,
  ignoreCandidate,
  unignoreCandidate,
  type Candidate,
  type EmailThread,
} from '../lib/api';
import { cn, formatTimeAgo } from '../lib/utils';
import {
  toastSuccess,
  toastError,
  extractApiErrorMessage,
} from '../lib/toast';
import {
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Mail,
  Building2,
  EyeOff,
  Eye,
  Users,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Sparkles,
  Search,
  X,
} from 'lucide-react';
import { StatusBadge, type StatusVariant } from './ui/StatusBadge';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Skeleton } from './ui/skeleton';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from './ui/empty';

function ReplyStatusBadge({ candidate }: { candidate: Candidate }) {
  const derived: NonNullable<Candidate['replyStatus']> =
    candidate.replyStatus ??
    (candidate.repliedAt
      ? 'REPLIED'
      : candidate.threads?.length
        ? 'AWAITING_REPLY'
        : 'NEW');

  const styles = {
    REPLIED:
      'bg-emerald-500/10 text-emerald-700 ring-1 ring-inset ring-emerald-500/20 dark:text-emerald-300',
    AWAITING_REPLY:
      'bg-amber-500/10 text-amber-700 ring-1 ring-inset ring-amber-500/20 dark:text-amber-300',
    NEW: 'bg-fg-strong/[0.04] text-fg-muted ring-1 ring-inset ring-fg-strong/[0.06]',
  }[derived];

  const label = {
    REPLIED: 'Replied',
    AWAITING_REPLY: 'Awaiting',
    NEW: 'New',
  }[derived];

  return (
    <Badge
      className={cn(
        'h-auto border-transparent px-2 py-0.5 text-[11px]',
        styles
      )}
    >
      {label}
    </Badge>
  );
}

function ThreadView({ threadId }: { threadId: string }) {
  const queryClient = useQueryClient();
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [genDone, setGenDone] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['thread', threadId],
    queryFn: () => fetchMessages(threadId),
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2 p-4">
        {[1, 2].map((i) => (
          <Skeleton key={i} className="h-16 rounded-lg" />
        ))}
      </div>
    );
  }

  const thread = data?.data as EmailThread | undefined;
  const messages = thread?.messages ?? [];
  const hasPendingDraft = thread?.drafts?.some((d) => d.status === 'PENDING' || d.status === 'APPROVED');

  const handleGenerateDraft = async () => {
    setGenerating(true);
    setGenError(null);
    try {
      await generateDraftForThread(threadId);
      setGenDone(true);
      void queryClient.invalidateQueries({ queryKey: ['drafts'] });
      void queryClient.invalidateQueries({ queryKey: ['thread', threadId] });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to generate draft';
      setGenError(msg);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="flex flex-col gap-2.5 p-4">
      <div className="max-h-56 flex flex-col gap-2.5 overflow-y-auto">
        {messages.length === 0 ? (
          <p className="text-[13px] text-fg-subtle">No messages yet</p>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className="rounded-lg border border-line-soft bg-surface-base/40 p-3"
            >
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[13px] font-medium text-fg-strong">
                  {msg.fromName ?? msg.fromAddress}
                </span>
                <span className="font-mono text-[11px] tabular-nums text-fg-subtle">
                  {formatTimeAgo(msg.receivedAt)}
                </span>
              </div>
              <p className="line-clamp-3 text-[12.5px] leading-relaxed text-fg-muted">
                {msg.bodyText}
              </p>
            </div>
          ))
        )}
      </div>
      {!hasPendingDraft && messages.length > 0 && (
        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={handleGenerateDraft}
            disabled={generating || genDone}
            className="flex items-center gap-1.5 rounded-lg border border-line bg-surface-raised/60 px-3 py-1.5 text-[12px] text-fg-muted hover:border-fg-muted/30 hover:text-fg-strong disabled:opacity-50"
          >
            <Sparkles className={`h-3.5 w-3.5 ${generating ? 'animate-pulse' : ''}`} />
            {generating ? 'Generating…' : genDone ? 'Draft created — check Drafts tab' : 'Generate draft'}
          </button>
          {genError && <span className="text-[11px] text-rose-600">{genError}</span>}
        </div>
      )}
    </div>
  );
}

interface Props {
  mailboxId?: string;
}

type SortColumn =
  | 'name'
  | 'email'
  | 'company'
  | 'role'
  | 'status'
  | 'reply'
  | 'updatedAt';
type SortDir = 'asc' | 'desc';

const STATUS_RANK: Record<string, number> = {
  INTERESTED: 0,
  NEEDS_REVIEW: 1,
  NEUTRAL: 2,
  PENDING: 3,
  REPLIED: 4,
  NOT_INTERESTED: 5,
  IGNORED: 6,
};
const REPLY_RANK: Record<string, number> = {
  AWAITING_REPLY: 0,
  NEW: 1,
  REPLIED: 2,
};

function deriveReplyStatus(c: Candidate): string {
  return (
    c.replyStatus ??
    (c.repliedAt ? 'REPLIED' : c.threads?.length ? 'AWAITING_REPLY' : 'NEW')
  );
}

function compareCandidates(
  a: Candidate,
  b: Candidate,
  column: SortColumn,
  dir: SortDir
): number {
  const sign = dir === 'asc' ? 1 : -1;
  const nullsLast = (v: unknown) => (v === null || v === undefined || v === '' ? 1 : 0);
  switch (column) {
    case 'name':
      return sign * (a.name || '').localeCompare(b.name || '');
    case 'email':
      return sign * (a.email || '').localeCompare(b.email || '');
    case 'company': {
      const na = nullsLast(a.company);
      const nb = nullsLast(b.company);
      if (na !== nb) return na - nb;
      return sign * (a.company || '').localeCompare(b.company || '');
    }
    case 'role': {
      const na = nullsLast(a.role);
      const nb = nullsLast(b.role);
      if (na !== nb) return na - nb;
      return sign * (a.role || '').localeCompare(b.role || '');
    }
    case 'status':
      return sign * ((STATUS_RANK[a.status] ?? 99) - (STATUS_RANK[b.status] ?? 99));
    case 'reply':
      return sign * ((REPLY_RANK[deriveReplyStatus(a)] ?? 99) - (REPLY_RANK[deriveReplyStatus(b)] ?? 99));
    case 'updatedAt': {
      const ta = new Date(a.updatedAt ?? 0).getTime();
      const tb = new Date(b.updatedAt ?? 0).getTime();
      return sign * (ta - tb);
    }
  }
}

function SortableTh({
  column,
  label,
  align = 'left',
  hiddenClass = '',
  current,
  onSort,
}: {
  column: SortColumn;
  label: string;
  align?: 'left' | 'right';
  hiddenClass?: string;
  current: { column: SortColumn; dir: SortDir };
  onSort: (column: SortColumn) => void;
}) {
  const active = current.column === column;
  const Icon = active ? (current.dir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <th
      className={cn(
        `px-4 py-3 text-${align}`,
        hiddenClass
      )}
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        className={cn(
          'inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.08em] transition-colors',
          active ? 'text-fg-strong' : 'text-fg-muted hover:text-fg-default'
        )}
      >
        <span>{label}</span>
        <Icon
          className={cn(
            'h-3 w-3 flex-shrink-0',
            active ? 'opacity-100' : 'opacity-50'
          )}
        />
      </button>
    </th>
  );
}

const PAGE_SIZE = 100;

export default function CandidateTable({ mailboxId }: Props) {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<{ column: SortColumn; dir: SortDir }>({
    column: 'updatedAt',
    dir: 'desc',
  });

  function handleSort(column: SortColumn) {
    setSort((prev) =>
      prev.column === column
        ? { column, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { column, dir: column === 'updatedAt' ? 'desc' : 'asc' }
    );
  }

  const includeIgnored = statusFilter === 'IGNORED' || statusFilter === '__ALL__';
  const apiStatus =
    statusFilter === '__ALL__' || statusFilter === '' ? undefined : statusFilter;

  // Reset to page 1 when filters change so a user mid-pagination doesn't
  // land on a page that no longer exists in the filtered view.
  useEffect(() => {
    setPage(1);
  }, [mailboxId, statusFilter, search]);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['candidates', { mailboxId, status: statusFilter, page, search }],
    queryFn: () =>
      fetchCandidates({
        mailboxId,
        status: search ? undefined : apiStatus,
        includeIgnored: search ? true : includeIgnored,
        page,
        limit: PAGE_SIZE,
        search: search || undefined,
      }),
    staleTime: 30_000,
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: Candidate['status'] }) =>
      updateCandidate(id, { status }),
    onSuccess: () => {
      toastSuccess('Status updated');
      void queryClient.invalidateQueries({ queryKey: ['candidates'] });
    },
    onError: (err) => {
      toastError(
        'Could not update status',
        extractApiErrorMessage(err, 'Please try again.')
      );
    },
  });

  const ignoreMutation = useMutation({
    mutationFn: (id: string) => ignoreCandidate(id),
    onSuccess: (_res, _id) => {
      toastSuccess(
        'Candidate ignored',
        "We won't generate new drafts and any pending ones were discarded."
      );
      void queryClient.invalidateQueries({ queryKey: ['candidates'] });
      void queryClient.invalidateQueries({ queryKey: ['drafts'] });
    },
    onError: (err) => {
      toastError(
        'Could not ignore candidate',
        extractApiErrorMessage(err, 'Please try again.')
      );
    },
  });

  const unignoreMutation = useMutation({
    mutationFn: (id: string) => unignoreCandidate(id),
    onSuccess: () => {
      toastSuccess('Candidate restored', 'They will appear in the dashboard again.');
      void queryClient.invalidateQueries({ queryKey: ['candidates'] });
      void queryClient.invalidateQueries({ queryKey: ['drafts'] });
    },
    onError: (err) => {
      toastError(
        'Could not restore candidate',
        extractApiErrorMessage(err, 'Please try again.')
      );
    },
  });

  const clearRepliedMutation = useMutation({
    mutationFn: (id: string) => clearRepliedAt(id),
    onSuccess: () => {
      toastSuccess('Reply status cleared', 'Candidate is now awaiting reply.');
      void queryClient.invalidateQueries({ queryKey: ['candidates'] });
    },
    onError: (err) => {
      toastError('Could not clear reply status', extractApiErrorMessage(err, 'Please try again.'));
    },
  });

  const candidatesRaw = data?.data ?? [];
  const candidates = [...candidatesRaw].sort((a, b) =>
    compareCandidates(a, b, sort.column, sort.dir)
  );

  if (error) {
    return (
      <div className="rounded-xl border border-line bg-surface-raised p-10 text-center">
        <p className="mb-3 text-rose-700 dark:text-rose-300">Failed to load candidates</p>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => refetch()}
          className="mx-auto"
        >
          <RefreshCw data-icon="inline-start" />
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-fg-strong sm:text-[28px]">
            Candidates
          </h1>
          <p className="mt-1 text-[13.5px] text-fg-muted">
            Every candidate detected across connected mailboxes.
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            disabled={!!search}
            className="appearance-none rounded-lg border border-line bg-surface-raised/70 py-1.5 pl-3 pr-9 text-[13px] text-fg-default transition-colors hover:border-line-strong focus:border-accent-400 focus:outline-none disabled:opacity-40"
          >
            <option value="">Active candidates</option>
            <option value="__ALL__">All (incl. ignored)</option>
            <option value="PENDING">Pending</option>
            <option value="INTERESTED">Interested</option>
            <option value="NOT_INTERESTED">Not Interested</option>
            <option value="NEUTRAL">Neutral</option>
            <option value="REPLIED">Replied</option>
            <option value="NEEDS_REVIEW">Needs Review</option>
            <option value="IGNORED">Ignored</option>
          </select>
          <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-muted" />
        </div>
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-muted" />
          <input
            type="text"
            placeholder="Search by name or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-line bg-surface-raised/70 py-1.5 pl-8 pr-8 text-[13px] text-fg-default placeholder:text-fg-subtle transition-colors hover:border-line-strong focus:border-accent-400 focus:outline-none"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-fg-muted hover:text-fg-strong"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <span className="font-mono text-[12px] tabular-nums text-fg-subtle">
          {data?.meta.total ?? 0} candidates
        </span>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-line bg-surface-raised/70">
        <table className="w-full">
          <thead>
            <tr className="border-b border-line">
              <SortableTh column="name" label="Name" current={sort} onSort={handleSort} />
              <SortableTh column="email" label="Email" current={sort} onSort={handleSort} />
              <SortableTh
                column="company"
                label="Company"
                hiddenClass="hidden md:table-cell"
                current={sort}
                onSort={handleSort}
              />
              <SortableTh column="status" label="Status" current={sort} onSort={handleSort} />
              <SortableTh column="reply" label="Reply" current={sort} onSort={handleSort} />
              <SortableTh
                column="updatedAt"
                label="Last activity"
                hiddenClass="hidden lg:table-cell"
                current={sort}
                onSort={handleSort}
              />
              <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-[0.08em] text-fg-muted">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-soft">
            {isLoading
              ? Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 7 }).map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <Skeleton className="h-4" />
                      </td>
                    ))}
                  </tr>
                ))
              : candidates.map((candidate) => (
                  <CandidateRow
                    key={candidate.id}
                    candidate={candidate}
                    expanded={expandedId === candidate.id}
                    onToggle={() =>
                      setExpandedId(
                        expandedId === candidate.id ? null : candidate.id
                      )
                    }
                    onChangeStatus={(status) =>
                      updateMutation.mutate({ id: candidate.id, status })
                    }
                    onIgnore={() => ignoreMutation.mutate(candidate.id)}
                    onUnignore={() => unignoreMutation.mutate(candidate.id)}
                    onClearReplied={() => clearRepliedMutation.mutate(candidate.id)}
                    ignoring={
                      ignoreMutation.isPending &&
                      ignoreMutation.variables === candidate.id
                    }
                    unignoring={
                      unignoreMutation.isPending &&
                      unignoreMutation.variables === candidate.id
                    }
                  />
                ))}
          </tbody>
        </table>

        {!isLoading && candidates.length === 0 && (
          <Empty className="px-6 py-16">
            <EmptyHeader>
              <EmptyMedia variant="icon" className="bg-fg-strong/[0.04] text-fg-muted">
                <Users className="size-5" />
              </EmptyMedia>
              <EmptyTitle className="font-display text-[15px] font-medium text-fg-strong">
                No candidates found
              </EmptyTitle>
              <EmptyDescription className="max-w-sm text-[13px] leading-relaxed text-fg-muted">
                {search
                  ? `No candidates match "${search}" — this email may not have been synced yet. Try resyncing from the Dashboard.`
                  : statusFilter
                  ? 'Try a different filter — or wait for new emails to be classified.'
                  : 'Candidates show up here as soon as their first email is processed.'}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}

        <PaginationFooter
          meta={data?.meta}
          page={page}
          onPrev={() => setPage((p) => Math.max(1, p - 1))}
          onNext={() => setPage((p) => p + 1)}
        />
      </div>
    </div>
  );
}

function PaginationFooter({
  meta,
  page,
  onPrev,
  onNext,
}: {
  meta: { total: number; page: number; limit: number } | undefined;
  page: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  // Don't render anything when there's no meta yet, or when the result set
  // fits on a single page. The empty state above already covers zero-row.
  if (!meta || meta.total <= meta.limit) return null;

  const limit = meta.limit;
  const total = meta.total;
  const start = (page - 1) * limit + 1;
  const end = Math.min(page * limit, total);
  const hasNext = end < total;
  const hasPrev = page > 1;

  return (
    <div
      data-testid="candidates-pagination-footer"
      className="flex items-center justify-between border-t border-line-soft px-4 py-3 text-[12.5px] text-fg-muted"
    >
      <span className="tabular-nums">
        Showing {start}–{end} of {total}
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onPrev}
          disabled={!hasPrev}
          className="rounded-md bg-fg-strong/[0.04] px-2.5 py-1 text-[12px] font-medium text-fg-default transition-colors hover:bg-fg-strong/[0.09] disabled:cursor-not-allowed disabled:opacity-40"
        >
          Previous
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={!hasNext}
          className="rounded-md bg-fg-strong/[0.04] px-2.5 py-1 text-[12px] font-medium text-fg-default transition-colors hover:bg-fg-strong/[0.09] disabled:cursor-not-allowed disabled:opacity-40"
        >
          Load more
        </button>
      </div>
    </div>
  );
}

interface CandidateRowProps {
  candidate: Candidate;
  expanded: boolean;
  onToggle: () => void;
  onChangeStatus: (status: Candidate['status']) => void;
  onIgnore: () => void;
  onUnignore: () => void;
  onClearReplied: () => void;
  ignoring: boolean;
  unignoring: boolean;
}

function CandidateRow({
  candidate,
  expanded,
  onToggle,
  onChangeStatus,
  onIgnore,
  onUnignore,
  onClearReplied,
  ignoring,
  unignoring,
}: CandidateRowProps) {
  return (
    <>
      <tr
        className="group cursor-pointer transition-colors hover:bg-fg-strong/[0.02]"
        onClick={onToggle}
      >
        <td className="px-4 py-3">
          <div className="flex items-start gap-2">
            {expanded ? (
              <ChevronUp className="mt-0.5 h-3.5 w-3.5 text-fg-muted" />
            ) : (
              <ChevronDown className="mt-0.5 h-3.5 w-3.5 text-fg-subtle group-hover:text-fg-muted" />
            )}
            <div className="min-w-0">
              <span className="text-[13.5px] font-medium text-fg-strong">
                {candidate.name}
              </span>
              <div className="mt-1">
                {candidate.role ? (
                  <span
                    data-testid="role-pill"
                    className="inline-flex max-w-full items-center gap-1 truncate rounded-md bg-accent-500/10 px-2 py-0.5 text-[11.5px] font-medium text-accent-700 ring-1 ring-inset ring-accent-500/20 dark:text-accent-300"
                    title={candidate.role}
                  >
                    <Users className="h-3 w-3 flex-shrink-0" />
                    {candidate.role}
                  </span>
                ) : (
                  <span
                    className="inline-flex items-center gap-1 rounded-md bg-fg-strong/[0.03] px-2 py-0.5 text-[11.5px] text-fg-subtle ring-1 ring-inset ring-fg-strong/[0.05]"
                    title="Role not detected by Claude on the original outreach"
                  >
                    <Users className="h-3 w-3 flex-shrink-0" />
                    Role not detected
                  </span>
                )}
              </div>
            </div>
          </div>
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center gap-1.5 text-[13px] text-fg-default">
            <Mail className="h-3.5 w-3.5 flex-shrink-0 text-fg-subtle" />
            <span className="truncate">{candidate.email}</span>
          </div>
        </td>
        <td className="hidden px-4 py-3 md:table-cell">
          {candidate.company ? (
            <div className="flex items-center gap-1.5 text-[13px] text-fg-muted">
              <Building2 className="h-3.5 w-3.5 flex-shrink-0 text-fg-subtle" />
              {candidate.company}
            </div>
          ) : (
            <span className="text-[13px] text-fg-subtle">—</span>
          )}
        </td>
        <td className="px-4 py-3">
          <StatusBadge status={candidate.status as StatusVariant} />
        </td>
        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-1.5">
            <ReplyStatusBadge candidate={candidate} />
            {(candidate.replyStatus === 'REPLIED' || candidate.repliedAt) && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={onClearReplied}
                    className="text-fg-subtle hover:text-rose-600 transition-colors"
                    aria-label="Clear replied status"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Clear "Replied" — marks as awaiting reply again</TooltipContent>
              </Tooltip>
            )}
          </div>
        </td>
        <td className="hidden px-4 py-3 lg:table-cell">
          <span className="font-mono text-[12px] tabular-nums text-fg-muted">
            {candidate.threads?.[0]
              ? formatTimeAgo(candidate.threads[0].lastMessageAt)
              : formatTimeAgo(candidate.updatedAt)}
          </span>
        </td>
        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-1.5">
            <div className="relative">
              <select
                value={candidate.status}
                onChange={(e) =>
                  onChangeStatus(e.target.value as Candidate['status'])
                }
                className="appearance-none rounded-md border border-line bg-surface-base/60 px-2 py-1 pr-6 text-[11.5px] text-fg-default focus:border-accent-400 focus:outline-none"
              >
                <option value="PENDING">Pending</option>
                <option value="INTERESTED">Interested</option>
                <option value="NOT_INTERESTED">Not Interested</option>
                <option value="NEUTRAL">Neutral</option>
                <option value="REPLIED">Replied</option>
                <option value="NEEDS_REVIEW">Needs Review</option>
                <option value="IGNORED">Ignored</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 h-3 w-3 -translate-y-1/2 text-fg-subtle" />
            </div>
            {candidate.status !== 'IGNORED' ? (
              <IgnoreConfirmButton
                candidateName={candidate.name}
                onConfirm={onIgnore}
                disabled={ignoring}
              />
            ) : (
              <button
                onClick={onUnignore}
                disabled={unignoring}
                title="Restore candidate (re-enables draft generation)"
                aria-label="Restore candidate"
                className="flex h-7 w-7 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-fg-strong/[0.06] hover:text-fg-strong disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Eye className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </td>
      </tr>
      {expanded &&
        candidate.threads &&
        candidate.threads.length > 0 && (
          <tr>
            <td
              colSpan={7}
              className="border-b border-line-soft bg-surface-base/40"
            >
              <ThreadView threadId={candidate.threads[0].id} />
            </td>
          </tr>
        )}
    </>
  );
}

function IgnoreConfirmButton({
  candidateName,
  onConfirm,
  disabled,
}: {
  candidateName: string;
  onConfirm: () => void;
  disabled: boolean;
}) {
  return (
    <AlertDialog>
      <Tooltip>
        <TooltipTrigger asChild>
          <AlertDialogTrigger asChild>
            <button
              disabled={disabled}
              aria-label="Ignore candidate"
              className="flex size-7 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-rose-500/15 hover:text-rose-700 dark:hover:text-rose-300 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <EyeOff className="h-3.5 w-3.5" />
            </button>
          </AlertDialogTrigger>
        </TooltipTrigger>
        <TooltipContent>Ignore candidate (mute future drafts; reversible)</TooltipContent>
      </Tooltip>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Ignore {candidateName}?</AlertDialogTitle>
          <AlertDialogDescription>
            They'll be hidden from the dashboard and any pending drafts will be
            discarded. You can restore them at any time.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={onConfirm}
          >
            Ignore candidate
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
