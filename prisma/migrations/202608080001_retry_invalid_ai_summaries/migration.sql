UPDATE "TrAiSessionSummary"
SET "status" = 'PENDING',
    "attemptCount" = 0,
    "leaseToken" = NULL,
    "leaseExpiresAt" = NULL,
    "availableAt" = CURRENT_TIMESTAMP,
    "unavailableReason" = NULL,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "status" = 'UNAVAILABLE'
  AND "unavailableReason" = 'OLLAMA_RESPONSE_INVALID';
