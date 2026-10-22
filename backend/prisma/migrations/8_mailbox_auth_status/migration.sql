-- AlterTable
-- Audit B1 / H1: track OAuth grant health per mailbox so a revoked refresh
-- token (invalid_grant) is surfaced instead of failing silently for months.
-- Additive only: existing rows default to 'OK'; the first cron run after
-- deploy flips revoked mailboxes (e.g. sofia@) to NEEDS_REAUTH.
ALTER TABLE "Mailbox" ADD COLUMN "authStatus" TEXT NOT NULL DEFAULT 'OK';
ALTER TABLE "Mailbox" ADD COLUMN "lastAuthError" TEXT;
ALTER TABLE "Mailbox" ADD COLUMN "lastAuthErrorAt" TIMESTAMP(3);
