-- F4 (feat/draft-cc-selector). Additive only: one nullable column, no
-- backfill. NULL keeps today's computed CC (DRAFT_CC_EMAIL) for existing
-- drafts; '' means the recruiter chose "No CC".
-- REQUIRES MIGRATION AUTHORIZATION before merge (vercel-build runs
-- prisma migrate deploy against prod).

-- AlterTable
ALTER TABLE "EmailDraft" ADD COLUMN     "ccEmail" TEXT;
