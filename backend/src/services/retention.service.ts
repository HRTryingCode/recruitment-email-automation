// Retention for message bodies on threads that never became candidate
// threads (audit B6 / H8).
//
// Since B6, new non-candidate mail is stored metadata-only at ingestion. This
// job handles what remains: bodies kept for context during bulk resync, and
// the backlog ingested before B6 (~18.7k rows). It nulls bodyText/bodyHtml
// only — subject, sender, recipients and threading headers are kept.
//
// DESTRUCTIVE and irreversible. The cron is a no-op until
// ORPHAN_BODY_RETENTION_DAYS is set, and the first run purges the whole
// backlog older than the window, so setting that env var needs the same
// explicit approval as running scripts/purge-orphan-bodies.ts --execute.

import type { Prisma } from '@prisma/client';
import { prisma } from '../db/client';

export const MIN_RETENTION_DAYS = 7;

export function orphanBodyWhere(cutoff: Date): Prisma.EmailMessageWhereInput {
  return {
    receivedAt: { lt: cutoff },
    thread: { candidateId: null },
    OR: [{ bodyText: { not: null } }, { bodyHtml: { not: null } }],
  };
}

/** Parses ORPHAN_BODY_RETENTION_DAYS; null (disabled) unless an integer >= 7. */
export function retentionDaysFromEnv(raw: string | undefined): number | null {
  if (!raw || !/^\d+$/.test(raw.trim())) return null;
  const days = parseInt(raw.trim(), 10);
  return days >= MIN_RETENTION_DAYS ? days : null;
}

export interface PurgeResult {
  cutoff: string;
  matched: number;
  purged: number;
  dryRun: boolean;
  complete: boolean;
}

export async function purgeOrphanBodies(opts: {
  olderThanDays: number;
  dryRun: boolean;
  batchSize?: number;
  /** Epoch ms; stop starting new batches after this (serverless timeout). */
  deadline?: number;
}): Promise<PurgeResult> {
  if (!Number.isInteger(opts.olderThanDays) || opts.olderThanDays < MIN_RETENTION_DAYS) {
    throw new Error(`olderThanDays must be an integer of at least ${MIN_RETENTION_DAYS}`);
  }
  const cutoff = new Date(Date.now() - opts.olderThanDays * 24 * 60 * 60 * 1000);
  const where = orphanBodyWhere(cutoff);
  const matched = await prisma.emailMessage.count({ where });

  if (opts.dryRun) {
    return { cutoff: cutoff.toISOString(), matched, purged: 0, dryRun: true, complete: true };
  }

  const batchSize = opts.batchSize ?? 500;
  let purged = 0;
  let complete = false;
  while (opts.deadline === undefined || Date.now() < opts.deadline) {
    const batch = await prisma.emailMessage.findMany({
      where,
      select: { id: true },
      take: batchSize,
    });
    if (batch.length === 0) {
      complete = true;
      break;
    }
    // Re-apply the filter so a thread linked to a candidate mid-run keeps its bodies.
    const { count } = await prisma.emailMessage.updateMany({
      where: { ...where, id: { in: batch.map((m) => m.id) } },
      data: { bodyText: null, bodyHtml: null },
    });
    purged += count;
    if (count === 0) {
      complete = true;
      break;
    }
  }

  return { cutoff: cutoff.toISOString(), matched, purged, dryRun: false, complete };
}
