-- H5 (perf/add-to-lever-dialog). Additive only: six nullable Candidate
-- columns caching Gem enrichment so the Add to Lever dialog doesn't wait on
-- GeMCP. No data is changed. REQUIRES MIGRATION AUTHORIZATION before merge
-- (vercel-build runs prisma migrate deploy against prod).

-- AlterTable
ALTER TABLE "Candidate" ADD COLUMN     "gemPersonId" TEXT,
ADD COLUMN     "gemTitle" TEXT,
ADD COLUMN     "gemCompany" TEXT,
ADD COLUMN     "gemLocation" TEXT,
ADD COLUMN     "gemResumeAvailable" BOOLEAN,
ADD COLUMN     "gemFetchedAt" TIMESTAMP(3);
