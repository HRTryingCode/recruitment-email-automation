// Persists Lever status onto Candidate rows (F2). The lever-sync cron calls
// syncStaleLever; POST /api/candidates/:id/lever/refresh calls
// refreshCandidateLever. Read-only against Lever (see lever.service.ts).
import type { Prisma } from '@prisma/client';
import { prisma } from '../db/client';
import { LeverClient, type LeverState, type LeverStatus } from './lever.service';

export const LEVER_STALE_MS = 3 * 60 * 60 * 1000;
const MAX_CONSECUTIVE_ERRORS = 5;

type LeverLookup = Pick<LeverClient, 'configured' | 'findByEmail'>;

export function leverColumns(s: LeverStatus) {
  const p = s.state === 'ERROR' ? null : s.primary;
  return {
    leverState: s.state,
    leverOpportunityId: p?.id ?? null,
    leverPostingTitle: p?.postingTitle ?? null,
    leverStage: p?.stage ?? null,
    leverArchivedReason: p?.archivedReason ?? null,
    leverCheckedAt: new Date(s.checkedAt),
    leverError: s.state === 'ERROR' ? s.reason ?? 'unknown' : null,
  };
}

export async function refreshCandidateLever(candidateId: string, client: LeverLookup = new LeverClient()) {
  const candidate = await prisma.candidate.findUnique({
    where: { id: candidateId },
    select: { id: true, email: true },
  });
  if (!candidate) return null;
  const status = await client.findByEmail(candidate.email);
  const updated = await prisma.candidate.update({ where: { id: candidate.id }, data: leverColumns(status) });
  return { candidate: updated, status };
}

export interface LeverSyncResult {
  skipped: boolean;
  reason?: string;
  candidates: number;
  checked: number;
  errors: number;
  byState: Partial<Record<LeverState, number>>;
  deadlineReached: boolean;
  aborted: boolean;
  elapsedMs: number;
}

/**
 * Refreshes candidates never checked or checked more than 3h ago, oldest
 * first (never-checked before everything else), until `deadline`. With
 * `neverCheckedOnly` (the 15-min lever-sync-new cron) only never-checked
 * candidates are selected, newest first, so new rows lose "Checking Lever…"
 * within minutes instead of up to 3h. Stops early after 5 consecutive ERROR
 * results so a revoked key or a Lever outage doesn't burn the whole run.
 */
export async function syncStaleLever(opts: {
  deadline: number;
  client?: LeverLookup;
  now?: () => number;
  concurrency?: number;
  batchSize?: number;
  neverCheckedOnly?: boolean;
}): Promise<LeverSyncResult> {
  const now = opts.now ?? Date.now;
  const start = now();
  const client = opts.client ?? new LeverClient();
  const result: LeverSyncResult = {
    skipped: false,
    candidates: 0,
    checked: 0,
    errors: 0,
    byState: {},
    deadlineReached: false,
    aborted: false,
    elapsedMs: 0,
  };

  if (!client.configured) {
    return { ...result, skipped: true, reason: 'unconfigured' };
  }

  const selection: Prisma.CandidateFindManyArgs = opts.neverCheckedOnly
    ? { where: { leverCheckedAt: null }, orderBy: [{ createdAt: 'desc' }] }
    : {
        where: {
          OR: [{ leverCheckedAt: null }, { leverCheckedAt: { lt: new Date(start - LEVER_STALE_MS) } }],
        },
        orderBy: [{ leverCheckedAt: { sort: 'asc', nulls: 'first' } }, { createdAt: 'asc' }],
      };
  const candidates = await prisma.candidate.findMany({
    where: selection.where,
    orderBy: selection.orderBy,
    select: { id: true, email: true },
    take: opts.batchSize ?? 3000,
  });
  result.candidates = candidates.length;

  let next = 0;
  let consecutiveErrors = 0;
  async function worker(): Promise<void> {
    while (next < candidates.length) {
      if (now() >= opts.deadline) {
        result.deadlineReached = true;
        return;
      }
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        result.aborted = true;
        return;
      }
      const c = candidates[next++]!;
      const status = await client.findByEmail(c.email);
      await prisma.candidate.update({ where: { id: c.id }, data: leverColumns(status) });
      result.checked += 1;
      result.byState[status.state] = (result.byState[status.state] ?? 0) + 1;
      if (status.state === 'ERROR') {
        result.errors += 1;
        consecutiveErrors += 1;
      } else {
        consecutiveErrors = 0;
      }
    }
  }
  const concurrency = Math.max(1, opts.concurrency ?? 4);
  await Promise.all(Array.from({ length: Math.min(concurrency, candidates.length) }, () => worker()));

  result.elapsedMs = now() - start;
  return result;
}
