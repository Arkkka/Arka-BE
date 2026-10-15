CREATE TABLE "TrParticipantSummary" (
  "id" UUID NOT NULL,
  "participantId" UUID NOT NULL,
  "institutionId" UUID NOT NULL,
  "savedSessionsTotal" INTEGER NOT NULL DEFAULT 0,
  "aggregateMetrics" JSONB NOT NULL,
  "participantSummary" VARCHAR(700) NOT NULL,
  "clinicianSummary" VARCHAR(1000) NOT NULL,
  "source" VARCHAR(32) NOT NULL DEFAULT 'DETERMINISTIC',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TrParticipantSummary_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TrParticipantSummary_participantId_key"
  ON "TrParticipantSummary"("participantId");

CREATE INDEX "TrParticipantSummary_institutionId_updatedAt_idx"
  ON "TrParticipantSummary"("institutionId", "updatedAt");

ALTER TABLE "TrParticipantSummary"
  ADD CONSTRAINT "TrParticipantSummary_participantId_fkey"
  FOREIGN KEY ("participantId") REFERENCES "MsParticipant"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TrParticipantSummary"
  ADD CONSTRAINT "TrParticipantSummary_institutionId_fkey"
  FOREIGN KEY ("institutionId") REFERENCES "MsInstitution"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
