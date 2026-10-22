import { useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, ArrowUpDown, Users } from 'lucide-react';
import { fetchCandidates, type Candidate } from '../lib/api';
import { filtersToApi, type CandidateFilters, type SortKey } from '../lib/candidates';
import { prefetchAddToLever } from '../lib/leverQueries';
import { useLeverAutoRefresh } from '../lib/leverAutoRefresh';
import { toastError, toastSuccess } from '../lib/toast';
import { useCandidateActions } from '../hooks/useCandidateActions';
import { CANDIDATE_SHORTCUTS, useCandidateShortcuts } from '../hooks/useCandidateShortcuts';
import { useCandidateUrlState } from '../hooks/useCandidateUrlState';
import PageHeader from './shell/PageHeader';
import QueryError from './shell/QueryError';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from './ui/empty';
import { Kbd } from './ui/kbd';
import { Skeleton } from './ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import BulkBar from './candidates/BulkBar';
import CandidateRow from './candidates/CandidateRow';
import CandidateSheet, { candidateQueryOptions } from './candidates/CandidateSheet';
import FilterBar from './candidates/FilterBar';
import IgnoreDialog, { type IgnoreRequest } from './candidates/IgnoreDialog';
import SavedViewsBar from './candidates/SavedViewsBar';

export const PAGE_SIZE = 50;

const COLUMNS: Array<{ key: SortKey; label: string; className?: string }> = [
  { key: 'name', label: 'Candidate', className: 'sticky left-0 bg-background' },
  { key: 'status', label: 'Reply' },
  { key: 'lever', label: 'Lever', className: 'hidden md:table-cell' },
  { key: 'role', label: 'Role', className: 'hidden xl:table-cell' },
  { key: 'mailbox', label: 'Mailbox', className: 'hidden xl:table-cell' },
  { key: 'lastActivity', label: 'Last activity', className: 'hidden sm:table-cell' },
];

function SortHead({
  column,
  filters,
  onSort,
}: {
  column: (typeof COLUMNS)[number];
  filters: CandidateFilters;
  onSort: (key: SortKey) => void;
}) {
  const current = filters.sort ?? 'lastActivity';
  const dir = filters.dir ?? (current === 'lastActivity' ? 'desc' : 'asc');
  const active = current === column.key;
  const Icon = active ? (dir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <TableHead
      aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={column.className}
    >
      <Button
        size="xs"
        variant="ghost"
        onClick={() => onSort(column.key)}
        className={active ? 'text-foreground' : 'text-muted-foreground'}
      >
        {column.label}
        <Icon data-icon="inline-end" className={active ? undefined : 'opacity-50'} />
      </Button>
    </TableHead>
  );
}

interface Props {
  mailboxId?: string;
}

/**
 * Candidates (R3): one-line rows, saved views, search + removable filter
 * chips, server-side sort on every column, bulk select, and a side panel
 * per candidate. Everything but the checkbox selection lives in the URL.
 */
export default function CandidateTable({ mailboxId }: Props) {
  const qc = useQueryClient();
  const url = useCandidateUrlState();
  const { filters, page, selectedId } = url;
  const actions = useCandidateActions();

  const apiParams = filtersToApi(filters, { page, limit: PAGE_SIZE, mailboxId });
  const listQ = useQuery({
    queryKey: ['candidates', apiParams],
    queryFn: () => fetchCandidates(apiParams),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
  const candidates = useMemo(() => listQ.data?.data ?? [], [listQ.data]);
  const total = listQ.data?.meta.total;
  useLeverAutoRefresh(candidates);

  // Bulk selection is per result set; a new query clears it.
  const queryKey = JSON.stringify(apiParams);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [cursor, setCursor] = useState(0);
  useEffect(() => {
    setChecked(new Set());
    setCursor(0);
  }, [queryKey]);

  const [ignoreReq, setIgnoreReq] = useState<IgnoreRequest>(null);

  const setFilters = (next: CandidateFilters, view?: string) => url.setFilters(next, view);
  const onSort = (key: SortKey) => {
    const current = filters.sort ?? 'lastActivity';
    const dir = filters.dir ?? (current === 'lastActivity' ? 'desc' : 'asc');
    const next =
      current === key
        ? { sort: key, dir: dir === 'asc' ? ('desc' as const) : ('asc' as const) }
        : { sort: key, dir: key === 'lastActivity' ? ('desc' as const) : ('asc' as const) };
    // Newest activity first is the default: keep it out of the URL.
    setFilters(next.sort === 'lastActivity' && next.dir === 'desc' ? { ...filters, sort: undefined, dir: undefined } : { ...filters, ...next });
  };

  const warm = (c: Candidate) => void qc.prefetchQuery(candidateQueryOptions(c.id));
  const open = (c: Candidate) => {
    // Opening warms Add to Lever (H5) when its button shows.
    if (c.leverState && c.leverState !== 'ERROR') prefetchAddToLever(qc, { candidateId: c.id });
    url.setSelected(c.id);
  };
  const copy = (email: string) => {
    void navigator.clipboard
      ?.writeText(email)
      .then(() => toastSuccess('Email copied'))
      .catch(() => toastError('Could not copy the email'));
  };
  const toggle = (id: string, on: boolean) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const menuFor = (c: Candidate) => ({
    onStatus: (status: Candidate['status']) =>
      status === 'IGNORED' ? setIgnoreReq({ ids: [c.id], label: c.name }) : actions.setStatus.mutate({ id: c.id, status }),
    onTriage: (decision: 'INTERESTED' | 'NOT_INTERESTED') => actions.triage.mutate({ candidate: c, decision }),
    onClearReplied: () => actions.clearReplied.mutate(c.id),
    onIgnore: () => setIgnoreReq({ ids: [c.id], label: c.name }),
    onRestore: () => actions.restore.mutate(c.id),
  });

  const panelOpen = !!selectedId;
  useCandidateShortcuts(
    {
      next: () => setCursor((i) => Math.min(i + 1, Math.max(candidates.length - 1, 0))),
      prev: () => setCursor((i) => Math.max(i - 1, 0)),
      open: () => candidates[cursor] && open(candidates[cursor]),
      close: () => panelOpen && url.setSelected(undefined),
      toggle: () => {
        const c = candidates[cursor];
        if (c) toggle(c.id, !checked.has(c.id));
      },
    },
    !ignoreReq
  );
  useEffect(() => {
    const c = candidates[cursor];
    if (!c) return;
    document.querySelector(`[data-candidate-id="${c.id}"]`)?.scrollIntoView?.({ block: 'nearest' });
    warm(c);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run on cursor moves only.
  }, [cursor]);

  const allChecked = candidates.length > 0 && candidates.every((c) => checked.has(c.id));
  const someChecked = !allChecked && candidates.some((c) => checked.has(c.id));
  const busyId = (actions.setStatus.isPending && actions.setStatus.variables?.id) || (actions.triage.isPending && actions.triage.variables?.candidate.id);
  const selectedRow = candidates.find((c) => c.id === selectedId);

  const confirmIgnore = (ids: string[]) => {
    if (ids.length === 1) actions.ignore.mutate(ids[0]!);
    else actions.bulk.mutate({ ids, status: 'IGNORED' });
    setChecked((prev) => new Set([...prev].filter((id) => !ids.includes(id))));
    setIgnoreReq(null);
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader heading="Candidates" description="Every candidate detected across connected mailboxes." />

      <SavedViewsBar filters={filters} viewId={url.viewId} onSelect={(v) => setFilters(v.filters, v.id)} />
      <FilterBar filters={filters} onChange={setFilters} total={total} />

      {listQ.isError ? (
        <QueryError thing="candidates" onRetry={() => void listQ.refetch()} retrying={listQ.isFetching} />
      ) : (
        <div className="overflow-hidden border-y border-border">
          {checked.size > 0 && (
            <BulkBar
              count={checked.size}
              busy={actions.bulk.isPending}
              onStatus={(status) => actions.bulk.mutate({ ids: [...checked], status }, { onSuccess: () => setChecked(new Set()) })}
              onIgnore={() => setIgnoreReq({ ids: [...checked], label: `${checked.size} candidate${checked.size === 1 ? '' : 's'}` })}
              onClear={() => setChecked(new Set())}
            />
          )}
          <Table data-testid="candidates-table">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-10 pl-3">
                  <Checkbox
                    aria-label="Select all on this page"
                    checked={allChecked ? true : someChecked ? 'indeterminate' : false}
                    onCheckedChange={(v) => setChecked(v === true ? new Set(candidates.map((c) => c.id)) : new Set())}
                  />
                </TableHead>
                {COLUMNS.map((col) => (
                  <SortHead key={col.key} column={col} filters={filters} onSort={onSort} />
                ))}
                <TableHead className="w-0 p-0">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {listQ.isLoading
                ? Array.from({ length: 6 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={COLUMNS.length + 2} className="py-2">
                        <Skeleton className="h-6 w-full" />
                      </TableCell>
                    </TableRow>
                  ))
                : candidates.map((c, i) => (
                    <CandidateRow
                      key={c.id}
                      candidate={c}
                      active={i === cursor}
                      selected={checked.has(c.id)}
                      busy={busyId === c.id}
                      onSelect={(on) => toggle(c.id, on)}
                      onOpen={() => {
                        setCursor(i);
                        open(c);
                      }}
                      onCopy={() => copy(c.email)}
                      onHover={() => warm(c)}
                      {...menuFor(c)}
                    />
                  ))}
            </TableBody>
          </Table>

          {!listQ.isLoading && candidates.length === 0 && (
            <Empty className="py-16">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Users />
                </EmptyMedia>
                <EmptyTitle>No candidates found</EmptyTitle>
                <EmptyDescription>
                  {filters.q
                    ? `No candidates match “${filters.q}” with these filters — this email may not have been synced yet.`
                    : 'Try a different view or filter — or wait for new emails to be classified.'}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}

          <PaginationFooter total={total} page={page} onPage={url.setPage} />
        </div>
      )}

      <p className="hidden items-center gap-1.5 text-xs text-muted-foreground md:flex">
        {CANDIDATE_SHORTCUTS.map((s) => (
          <span key={s.id} className="inline-flex items-center gap-1">
            <Kbd>{s.keys.join(' ')}</Kbd>
            {s.label.toLowerCase()}
          </span>
        ))}
      </p>

      <CandidateSheet
        candidateId={selectedId}
        row={selectedRow}
        onClose={() => url.setSelected(undefined)}
        onCopy={copy}
        menuFor={menuFor}
      />
      <IgnoreDialog request={ignoreReq} onCancel={() => setIgnoreReq(null)} onConfirm={confirmIgnore} />
    </div>
  );
}

function PaginationFooter({ total, page, onPage }: { total: number | undefined; page: number; onPage: (n: number) => void }) {
  // Nothing to page through: the empty state or a single page covers it.
  if (!total || total <= PAGE_SIZE) return null;
  const start = (page - 1) * PAGE_SIZE + 1;
  const end = Math.min(page * PAGE_SIZE, total);
  return (
    <div
      data-testid="candidates-pagination-footer"
      className="flex items-center justify-between border-t border-border px-3 py-2 text-xs text-muted-foreground"
    >
      <span className="tabular-nums">
        Showing {start}–{end} of {total}
      </span>
      <div className="flex items-center gap-2">
        <Button size="xs" variant="outline" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </Button>
        <Button size="xs" variant="outline" disabled={end >= total} onClick={() => onPage(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}
