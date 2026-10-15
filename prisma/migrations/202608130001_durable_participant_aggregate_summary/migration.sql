ALTER TABLE "TrParticipantSummary"
ADD COLUMN IF NOT EXISTS "attemptCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "leaseToken" UUID,
ADD COLUMN IF NOT EXISTS "leaseExpiresAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS "TrParticipantSummary_source_availableAt_leaseExpiresAt_idx"
ON "TrParticipantSummary"("source", "availableAt", "leaseExpiresAt");

UPDATE "TrParticipantSummary"
SET "source" = 'PENDING',
    "attemptCount" = 0,
    "leaseToken" = NULL,
    "leaseExpiresAt" = NULL,
    "availableAt" = CURRENT_TIMESTAMP,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "source" = 'PROCESSING';
