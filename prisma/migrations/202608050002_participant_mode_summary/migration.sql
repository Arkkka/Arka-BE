CREATE TABLE "TrParticipantModeSummary" (
  "id" UUID NOT NULL,
  "participantId" UUID NOT NULL,
  "institutionId" UUID NOT NULL,
  "mode" "GameMode" NOT NULL,
  "aggregateMetrics" JSONB NOT NULL,
  "participantSummary" VARCHAR(700) NOT NULL DEFAULT '',
  "clinicianSummary" VARCHAR(1000) NOT NULL DEFAULT '',
  "source" VARCHAR(32) NOT NULL DEFAULT 'PENDING',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "leaseToken" UUID,
  "leaseExpiresAt" TIMESTAMP(3),
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TrParticipantModeSummary_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TrParticipantModeSummary_participantId_mode_key"
ON "TrParticipantModeSummary"("participantId", "mode");

CREATE INDEX "TrParticipantModeSummary_institutionId_mode_updatedAt_idx"
ON "TrParticipantModeSummary"("institutionId", "mode", "updatedAt");

CREATE INDEX "TrParticipantModeSummary_source_availableAt_leaseExpiresAt_idx"
ON "TrParticipantModeSummary"("source", "availableAt", "leaseExpiresAt");

ALTER TABLE "TrParticipantModeSummary"
ADD CONSTRAINT "TrParticipantModeSummary_participantId_institutionId_fkey"
FOREIGN KEY ("participantId", "institutionId") REFERENCES "MsParticipant"("id", "institutionId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TrParticipantModeSummary"
ADD CONSTRAINT "TrParticipantModeSummary_institutionId_fkey"
FOREIGN KEY ("institutionId") REFERENCES "MsInstitution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
