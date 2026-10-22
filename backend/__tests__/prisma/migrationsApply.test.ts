import { describe, it, expect, beforeAll } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { migratedDb } from '../_setup/pglite';

describe('prisma migrations apply on a real Postgres', () => {
  let db: PGlite;
  beforeAll(async () => {
    db = await migratedDb();
  }, 60_000);

  it('9g_inbox: one live draft per thread, including SCHEDULED/SENDING/FAILED', async () => {
    await db.exec(`
      INSERT INTO "Mailbox" (id, "emailAddress", "updatedAt") VALUES ('mb1', 'a@archive.com', now());
      INSERT INTO "EmailThread" (id, "mailboxId", "externalThreadId", subject) VALUES ('t1', 'mb1', 'x1', 's');
      INSERT INTO "EmailDraft" (id, "threadId", subject, "bodyText", classification, confidence, status, "updatedAt")
        VALUES ('d1', 't1', 's', 'b', 'INTERESTED', 0.9, 'SCHEDULED', now());
    `);
    for (const status of ['PENDING', 'SENDING', 'FAILED']) {
      await expect(
        db.exec(`INSERT INTO "EmailDraft" (id, "threadId", subject, "bodyText", classification, confidence, status, "updatedAt")
                 VALUES ('d-${status}', 't1', 's', 'b', 'INTERESTED', 0.9, '${status}', now())`)
      ).rejects.toThrow(/EmailDraft_threadId_live_key/);
    }
    // Terminal states don't count.
    await db.exec(`INSERT INTO "EmailDraft" (id, "threadId", subject, "bodyText", classification, confidence, status, "updatedAt")
                   VALUES ('d-sent', 't1', 's', 'b', 'INTERESTED', 0.9, 'SENT', now())`);
  });

  it('9g_inbox: presence is unique per (draft, user) and cascades with the draft', async () => {
    await db.exec(`
      INSERT INTO "User" (id, email, "updatedAt") VALUES ('u1', 'u1@archive.com', now());
      INSERT INTO "DraftPresence" (id, "draftId", "userId", mode) VALUES ('p1', 'd1', 'u1', 'editing');
    `);
    await expect(
      db.exec(`INSERT INTO "DraftPresence" (id, "draftId", "userId", mode) VALUES ('p2', 'd1', 'u1', 'viewing')`)
    ).rejects.toThrow(/DraftPresence_draftId_userId_key/);
    await db.exec(`DELETE FROM "EmailDraft" WHERE id = 'd1'`);
    const left = await db.query(`SELECT count(*)::int AS n FROM "DraftPresence"`);
    expect(left.rows[0]).toEqual({ n: 0 });
  });
});
