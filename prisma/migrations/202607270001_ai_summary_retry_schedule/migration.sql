-- Schedule retryable local AI summaries without immediately reclaiming failed work.
ALTER TABLE "AiSessionSummary"
ADD COLUMN "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

DROP INDEX "AiSessionSummary_status_leaseExpiresAt_idx";
CREATE INDEX "AiSessionSummary_status_availableAt_leaseExpiresAt_idx"
ON "AiSessionSummary"("status", "availableAt", "leaseExpiresAt");
