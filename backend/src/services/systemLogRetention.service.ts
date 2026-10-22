import { prisma } from '../db/client';

// SystemLog retention (audit M26). The table had ~540k rows / ~100 MB with no
// retention, 90% of it May 2026 WEBHOOK_AUTH_REJECTED noise.
//
// Deleting is a destructive prod write, so the daily cron only *counts* what
// it would delete unless SYSTEMLOG_RETENTION_ENABLED=true is set (a human
// decision — see the B4 PR). Deletes run in bounded batches so the first run
// against the backlog never holds a long lock or blows the function timeout;
// a run that hits its deadline reports complete=false and the next day's run
// continues.
export const SYSTEMLOG_RETENTION = { infoDays: 30, otherDays: 90 } as const;

const DAY_MS = 24 * 60 * 60 * 1000;

export type PruneResult =
  | { enabled: false; deleted: 0; wouldDelete: { info: number; other: number } }
  | { enabled: true; deleted: number; complete: boolean };

export async function pruneSystemLog(opts: {
  enabled: boolean;
  now?: Date;
  batchSize?: number;
  deadline?: number;
}): Promise<PruneResult> {
  const now = (opts.now ?? new Date()).getTime();
  const infoCutoff = new Date(now - SYSTEMLOG_RETENTION.infoDays * DAY_MS);
  const otherCutoff = new Date(now - SYSTEMLOG_RETENTION.otherDays * DAY_MS);

  if (!opts.enabled) {
    // Sequential, not Promise.all: the prod pool may be connection_limit=1.
    const info = await prisma.systemLog.count({
      where: { level: 'INFO', createdAt: { lt: infoCutoff } },
    });
    const other = await prisma.systemLog.count({
      where: { level: { not: 'INFO' }, createdAt: { lt: otherCutoff } },
    });
    return { enabled: false, deleted: 0, wouldDelete: { info, other } };
  }

  const batchSize = opts.batchSize ?? 5_000;
  const pastDeadline = () => opts.deadline !== undefined && Date.now() > opts.deadline;
  let deleted = 0;

  const passes = [
    () =>
      prisma.$executeRaw`DELETE FROM "SystemLog" WHERE "id" IN (
        SELECT "id" FROM "SystemLog" WHERE "level" = 'INFO' AND "createdAt" < ${infoCutoff} LIMIT ${batchSize})`,
    () =>
      prisma.$executeRaw`DELETE FROM "SystemLog" WHERE "id" IN (
        SELECT "id" FROM "SystemLog" WHERE "level" <> 'INFO' AND "createdAt" < ${otherCutoff} LIMIT ${batchSize})`,
  ];
  for (const deleteBatch of passes) {
    for (;;) {
      if (pastDeadline()) return { enabled: true, deleted, complete: false };
      const n = await deleteBatch();
      deleted += n;
      if (n < batchSize) break;
    }
  }
  return { enabled: true, deleted, complete: true };
}
