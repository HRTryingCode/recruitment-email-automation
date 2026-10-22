-- F2 (feat/lever-status). Additive only: nullable Candidate columns and one
-- index. No data is changed. REQUIRES MIGRATION AUTHORIZATION before merge
-- (vercel-build runs prisma migrate deploy against prod).

-- AlterTable
ALTER TABLE "Candidate" ADD COLUMN     "leverArchivedReason" TEXT,
ADD COLUMN     "leverCheckedAt" TIMESTAMP(3),
ADD COLUMN     "leverError" TEXT,
ADD COLUMN     "leverOpportunityId" TEXT,
ADD COLUMN     "leverPostingTitle" TEXT,
ADD COLUMN     "leverStage" TEXT,
ADD COLUMN     "leverState" TEXT;

-- CreateIndex
CREATE INDEX "Candidate_leverState_idx" ON "Candidate"("leverState");
