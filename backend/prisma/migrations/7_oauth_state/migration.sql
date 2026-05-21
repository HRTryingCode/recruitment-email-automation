-- CreateTable
-- Persistent OAuth state for CSRF protection on the Gmail connect flow.
-- Replaces the in-process Map in lib/oauthState.ts so the auth-init and
-- callback handlers can survive landing on different Vercel function
-- instances. Rows are reaped opportunistically (older than the 10-minute
-- TTL) on each insert, so this table stays bounded without a cron job.
CREATE TABLE "OAuthState" (
    "state" TEXT NOT NULL,
    "mailboxId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consumedAt" TIMESTAMP(3),

    CONSTRAINT "OAuthState_pkey" PRIMARY KEY ("state")
);

-- CreateIndex
-- Speeds up the opportunistic reaper, which does
-- `deleteMany({ where: { createdAt: { lt: tenMinAgo } } })` on each insert.
CREATE INDEX "OAuthState_createdAt_idx" ON "OAuthState"("createdAt");
