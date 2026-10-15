UPDATE "TrParticipantSummary"
SET "source" = 'PENDING',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "savedSessionsTotal" > 0;
