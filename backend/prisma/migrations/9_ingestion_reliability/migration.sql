-- Audit B4: ingestion reliability (H4, M1, M3, M24, M25, M26, L1, L2, L3).
-- REQUIRES MIGRATION AUTHORIZATION: runs against prod via `prisma migrate
-- deploy` on merge.
--
-- Everything is additive except step 5, which discards the OLDER of any two
-- live (PENDING/APPROVED) drafts on the same thread so the partial unique
-- index can be built. On 2026-10-22 that matched 3 drafts from May/June 2026.
-- Without it the CREATE UNIQUE INDEX fails and the deploy aborts.
--
-- The SystemLog indexes are built non-concurrently (prisma wraps each
-- migration in a transaction). On ~540k rows / ~100 MB this briefly blocks
-- SystemLog writes (expected: a few seconds).

-- 1. M1: fair reconcile ordering.
ALTER TABLE "Mailbox" ADD COLUMN "lastReconciledAt" TIMESTAMP(3);

-- 2. M3: per-message pipeline state. Existing rows are treated as PROCESSED.
ALTER TABLE "EmailMessage" ADD COLUMN "processingState" TEXT NOT NULL DEFAULT 'PROCESSED';
ALTER TABLE "EmailMessage" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;
CREATE INDEX "EmailMessage_processingState_createdAt_idx" ON "EmailMessage"("processingState", "createdAt");

-- 3. M25 / L1: tombstones for unfetchable Gmail ids.
CREATE TABLE "GmailFetchTombstone" (
    "id" TEXT NOT NULL,
    "mailboxId" TEXT NOT NULL,
    "externalMessageId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GmailFetchTombstone_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GmailFetchTombstone_mailboxId_externalMessageId_key" ON "GmailFetchTombstone"("mailboxId", "externalMessageId");
CREATE INDEX "GmailFetchTombstone_updatedAt_idx" ON "GmailFetchTombstone"("updatedAt");

-- 4. M26: SystemLog indexes for sync-health / watchdog / retention queries.
CREATE INDEX "SystemLog_event_createdAt_idx" ON "SystemLog"("event", "createdAt");
CREATE INDEX "SystemLog_createdAt_idx" ON "SystemLog"("createdAt");

-- 5. L3: at most one live draft per thread.
UPDATE "EmailDraft" d
SET "status" = 'DISCARDED', "updatedAt" = CURRENT_TIMESTAMP
WHERE d."status" IN ('PENDING', 'APPROVED')
  AND EXISTS (
    SELECT 1 FROM "EmailDraft" newer
    WHERE newer."threadId" = d."threadId"
      AND newer."status" IN ('PENDING', 'APPROVED')
      AND (newer."createdAt", newer."id") > (d."createdAt", d."id")
  );
CREATE UNIQUE INDEX "EmailDraft_threadId_live_key" ON "EmailDraft"("threadId") WHERE "status" IN ('PENDING', 'APPROVED');
