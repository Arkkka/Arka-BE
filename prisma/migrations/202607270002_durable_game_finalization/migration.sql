-- Persist the authoritative terminal payload before result materialization so finalization can resume after restart.
ALTER TABLE "GameSession" ADD COLUMN "finalizationPayload" JSONB;
