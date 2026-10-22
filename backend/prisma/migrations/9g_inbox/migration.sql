-- U0 (feat/inbox-backend): one-step send with undo, dismiss, snooze,
-- AI-vs-edited bodies, classifier evidence, presence lock, saved views.
-- Additive only. No backfill: aiBodyText stays NULL ("unknown") on existing
-- drafts, because some of them were already edited and copying bodyText
-- would label recruiter text as AI-written.
-- REQUIRES MIGRATION AUTHORIZATION before merge (vercel-build runs
-- prisma migrate deploy against prod).

-- AlterTable
ALTER TABLE "EmailDraft" ADD COLUMN "scheduledSendAt" TIMESTAMP(3),
ADD COLUMN "sentByUserId" TEXT,
ADD COLUMN "sendError" TEXT,
ADD COLUMN "snoozedUntil" TIMESTAMP(3),
ADD COLUMN "returnedFromSnoozeAt" TIMESTAMP(3),
ADD COLUMN "dismissReason" TEXT,
ADD COLUMN "dismissNote" TEXT,
ADD COLUMN "dismissedByUserId" TEXT,
ADD COLUMN "aiBodyText" TEXT,
ADD COLUMN "editedAt" TIMESTAMP(3),
ADD COLUMN "editedByUserId" TEXT,
ADD COLUMN "classificationReason" TEXT,
ADD COLUMN "evidenceQuote" TEXT;

-- CreateIndex
CREATE INDEX "EmailDraft_status_scheduledSendAt_idx" ON "EmailDraft"("status", "scheduledSendAt");
CREATE INDEX "EmailDraft_snoozedUntil_idx" ON "EmailDraft"("snoozedUntil");

-- Live-draft uniqueness now also covers the one-step-send states. Existing
-- rows only use PENDING/APPROVED/SENT/DISCARDED, so the new index admits
-- exactly the rows the old one did.
DROP INDEX "EmailDraft_threadId_live_key";
CREATE UNIQUE INDEX "EmailDraft_threadId_live_key" ON "EmailDraft"("threadId") WHERE "status" IN ('PENDING', 'APPROVED', 'SCHEDULED', 'SENDING', 'FAILED');

-- CreateTable
CREATE TABLE "DraftPresence" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "heartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DraftPresence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DraftPresence_draftId_userId_key" ON "DraftPresence"("draftId", "userId");
CREATE INDEX "DraftPresence_heartbeatAt_idx" ON "DraftPresence"("heartbeatAt");

ALTER TABLE "DraftPresence" ADD CONSTRAINT "DraftPresence_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "EmailDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DraftPresence" ADD CONSTRAINT "DraftPresence_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "SavedView" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "filters" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedView_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SavedView_scope_userId_idx" ON "SavedView"("scope", "userId");

ALTER TABLE "SavedView" ADD CONSTRAINT "SavedView_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
