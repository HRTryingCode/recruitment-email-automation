-- Audit B3 (H2, M11): sender coverage. Additive only.
-- REQUIRES MIGRATION AUTHORIZATION before merge (vercel-build runs migrate deploy).

-- AlterTable
ALTER TABLE "Mailbox" ADD COLUMN "sendAsAddresses" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Mailbox" ADD COLUMN "sendAsSyncedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ExpectedSender" (
    "id" TEXT NOT NULL,
    "emailAddress" TEXT NOT NULL,
    "displayName" TEXT,
    "source" TEXT NOT NULL DEFAULT 'ADMIN',
    "externalId" TEXT,
    "expectedSends30d" INTEGER,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExpectedSender_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExpectedSender_emailAddress_key" ON "ExpectedSender"("emailAddress");
