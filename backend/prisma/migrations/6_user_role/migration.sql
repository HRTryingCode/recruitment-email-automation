-- AlterTable
-- Add the RBAC role column. Default `recruiter` keeps every existing user
-- non-privileged; admin-only endpoints (mailbox resync, refresh-all-profiles,
-- regenerate-pending, backfill-roles, DELETE mailbox) then return 403 for
-- anyone whose role wasn't bumped manually.
ALTER TABLE "User" ADD COLUMN "role" TEXT NOT NULL DEFAULT 'recruiter';

-- Promote the founding operator so they don't lock themselves out of the
-- admin-only endpoints on first deploy. Idempotent: no-op if the user row
-- does not exist yet (the next @archive.com sign-in will create it with the
-- default recruiter role, and this UPDATE will be a no-op for that case
-- because we only match on the literal email).
UPDATE "User" SET "role" = 'admin' WHERE "email" = 'andriy@archive.com';
