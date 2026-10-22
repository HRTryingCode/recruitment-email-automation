-- H2 (feat/lever-realtime). Additive only: one new table used to dedupe
-- Lever webhook deliveries. No existing data is changed. REQUIRES MIGRATION
-- AUTHORIZATION before merge (vercel-build runs prisma migrate deploy
-- against prod).

-- CreateTable
CREATE TABLE "LeverWebhookEvent" (
    "id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "opportunityId" TEXT,
    "triggeredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeverWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeverWebhookEvent_createdAt_idx" ON "LeverWebhookEvent"("createdAt");
