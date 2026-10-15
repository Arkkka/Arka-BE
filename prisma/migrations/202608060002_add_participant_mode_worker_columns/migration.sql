ALTER TABLE "TrParticipantModeSummary"
ADD COLUMN IF NOT EXISTS "attemptCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "leaseToken" UUID,
ADD COLUMN IF NOT EXISTS "leaseExpiresAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS "TrParticipantModeSummary_source_availableAt_leaseExpiresAt_idx"
ON "TrParticipantModeSummary"("source", "availableAt", "leaseExpiresAt");
