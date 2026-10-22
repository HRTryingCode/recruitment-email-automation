/**
 * ONE-OFF BACKLOG PURGE — audit B6 / H8. DO NOT RUN WITHOUT EXPLICIT APPROVAL.
 *
 * Nulls bodyText/bodyHtml on EmailMessage rows whose thread has no candidate
 * (the ~18.7k non-recruiting / internal messages ingested before B6) and that
 * are older than --older-than-days (default 30). Subject, sender, recipients
 * and threading headers are kept. Irreversible.
 *
 * Default is a DRY RUN that only prints counts. Nothing is written unless
 * --execute is passed.
 *
 *   # dry run (read-only):
 *   POSTGRES_PRISMA_URL=... npx tsx scripts/purge-orphan-bodies.ts
 *   # actually purge (needs sign-off; take a backup / PITR marker first):
 *   POSTGRES_PRISMA_URL=... npx tsx scripts/purge-orphan-bodies.ts --execute --older-than-days 30
 *
 * Read-only SQL to preview the same set:
 *   SELECT count(*) FROM "EmailMessage" m JOIN "EmailThread" t ON t.id = m."threadId"
 *   WHERE t."candidateId" IS NULL AND m."receivedAt" < now() - interval '30 days'
 *     AND (m."bodyText" IS NOT NULL OR m."bodyHtml" IS NOT NULL);
 *
 * Prints counts only — never message content.
 */
import { prisma } from '../src/db/client';
import { purgeOrphanBodies } from '../src/services/retention.service';

function parseArgs(argv: string[]): { execute: boolean; olderThanDays: number } {
  const execute = argv.includes('--execute');
  const i = argv.indexOf('--older-than-days');
  const olderThanDays = i >= 0 ? parseInt(argv[i + 1] ?? '', 10) : 30;
  if (!Number.isInteger(olderThanDays)) {
    throw new Error('--older-than-days must be an integer');
  }
  return { execute, olderThanDays };
}

async function main(): Promise<void> {
  const { execute, olderThanDays } = parseArgs(process.argv.slice(2));
  const result = await purgeOrphanBodies({ olderThanDays, dryRun: !execute });
  console.log(
    execute
      ? `[purge-orphan-bodies] EXECUTED: cutoff=${result.cutoff} matched=${result.matched} purged=${result.purged} complete=${result.complete}`
      : `[purge-orphan-bodies] DRY RUN (pass --execute to write): cutoff=${result.cutoff} would purge=${result.matched}`
  );
}

main()
  .catch((err) => {
    console.error('[purge-orphan-bodies] failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
