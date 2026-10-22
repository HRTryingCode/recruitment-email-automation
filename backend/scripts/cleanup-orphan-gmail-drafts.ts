/**
 * One-off cleanup (audit M13): DISCARDED EmailDraft rows whose Gmail draft
 * was never deleted (prod 2026-10-22: 40 rows). Those drafts still sit in the
 * recruiters' Gmail "Drafts" folders and could be sent by mistake.
 *
 * NOT RUN AUTOMATICALLY. Requires explicit authorization — it deletes Gmail
 * drafts in recruiters' mailboxes and clears externalDraftId on the rows.
 *
 *   # dry run (default): lists what would be deleted
 *   npx tsx scripts/cleanup-orphan-gmail-drafts.ts
 *   # apply
 *   npx tsx scripts/cleanup-orphan-gmail-drafts.ts --apply
 *
 * Needs the production env (POSTGRES_PRISMA_URL, ENCRYPTION_KEY, GMAIL_* …).
 * Only ids are printed — never subjects or bodies.
 */
import { prisma } from '../src/db/client';
import { deleteDraft } from '../src/services/gmail.service';

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const rows = await prisma.emailDraft.findMany({
    where: { status: 'DISCARDED', externalDraftId: { not: null } },
    select: { id: true, externalDraftId: true, thread: { select: { mailboxId: true } } },
  });
  console.log(`${rows.length} discarded drafts still have a Gmail draft${apply ? '' : ' (dry run)'}`);

  let deleted = 0;
  let gone = 0;
  let failed = 0;
  for (const row of rows) {
    if (!apply) {
      console.log(`would delete draft=${row.id} mailbox=${row.thread.mailboxId}`);
      continue;
    }
    try {
      await deleteDraft(row.thread.mailboxId, row.externalDraftId!);
      deleted += 1;
    } catch (err) {
      const code = (err as { code?: unknown })?.code;
      if (code === 404) {
        gone += 1;
      } else {
        failed += 1;
        console.warn(`failed draft=${row.id}: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
    }
    await prisma.emailDraft.update({ where: { id: row.id }, data: { externalDraftId: null } });
  }
  if (apply) console.log(`deleted=${deleted} alreadyGone=${gone} failed=${failed}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
