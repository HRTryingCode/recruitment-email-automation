-- F3 (feat/add-to-lever). Additive only: one nullable Candidate column and a
-- new GemConnection table. No data is changed. REQUIRES MIGRATION
-- AUTHORIZATION before merge (vercel-build runs prisma migrate deploy
-- against prod).

-- AlterTable
ALTER TABLE "Candidate" ADD COLUMN     "linkedinUrl" TEXT;

-- CreateTable
CREATE TABLE "GemConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokens" TEXT,
    "clientRegistration" JSONB,
    "pendingVerifier" TEXT,
    "expiresAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GemConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GemConnection_userId_key" ON "GemConnection"("userId");

-- AddForeignKey
ALTER TABLE "GemConnection" ADD CONSTRAINT "GemConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
