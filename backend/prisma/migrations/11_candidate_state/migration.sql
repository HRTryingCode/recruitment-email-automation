-- B7 (audit/classification-and-candidate-state). Additive only: nullable
-- columns, one index, one FK. No data is changed here; backfills live in
-- scripts/b7/*.sql and are NOT run by migrate deploy.
-- REQUIRES MIGRATION AUTHORIZATION before merge (vercel-build runs
-- prisma migrate deploy against prod).

-- AlterTable
ALTER TABLE "Mailbox" ADD COLUMN     "handoffProfile" TEXT;

-- AlterTable
ALTER TABLE "Candidate" ADD COLUMN     "firstMailboxId" TEXT,
ADD COLUMN     "lastInboundAt" TIMESTAMP(3),
ADD COLUMN     "lastOutboundAt" TIMESTAMP(3),
ADD COLUMN     "ownerUserId" TEXT;

-- AlterTable
ALTER TABLE "EmailDraft" ADD COLUMN     "model" TEXT,
ADD COLUMN     "promptVersion" TEXT,
ADD COLUMN     "usage" JSONB;

-- CreateIndex
CREATE INDEX "Candidate_ownerUserId_idx" ON "Candidate"("ownerUserId");

-- AddForeignKey
ALTER TABLE "Candidate" ADD CONSTRAINT "Candidate_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

