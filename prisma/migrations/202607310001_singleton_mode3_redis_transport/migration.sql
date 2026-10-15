ALTER TABLE "DeviceReservation" DROP CONSTRAINT IF EXISTS "DeviceReservation_tenant_device_fkey";
ALTER TABLE "DeviceReservation" DROP CONSTRAINT IF EXISTS "DeviceReservation_tenant_preparation_fkey";
ALTER TABLE "DeviceReservation" DROP CONSTRAINT IF EXISTS "DeviceReservation_tenant_session_fkey";
ALTER TABLE "DeviceReservation" DROP CONSTRAINT IF EXISTS "DeviceReservation_deviceId_fkey";
ALTER TABLE "DeviceReservation" DROP CONSTRAINT IF EXISTS "DeviceReservation_preparationId_fkey";
ALTER TABLE "DeviceReservation" DROP CONSTRAINT IF EXISTS "DeviceReservation_sessionId_fkey";
ALTER TABLE "DeviceCommand" DROP CONSTRAINT IF EXISTS "DeviceCommand_deviceId_fkey";
ALTER TABLE "DeviceCommand" DROP CONSTRAINT IF EXISTS "DeviceCommand_sessionId_fkey";
ALTER TABLE "GameSession" DROP CONSTRAINT IF EXISTS "GameSession_preparation_source_fkey";
ALTER TABLE "GameSession" DROP CONSTRAINT IF EXISTS "GameSession_tenant_device_fkey";
ALTER TABLE "GameSession" DROP CONSTRAINT IF EXISTS "GameSession_deviceId_fkey";
ALTER TABLE "GameSession" DROP CONSTRAINT IF EXISTS "GameSession_tenant_rule_fkey";
ALTER TABLE "GamePreparation" DROP CONSTRAINT IF EXISTS "GamePreparation_tenant_device_fkey";
ALTER TABLE "GamePreparation" DROP CONSTRAINT IF EXISTS "GamePreparation_deviceId_fkey";
ALTER TABLE "GamePreparation" DROP CONSTRAINT IF EXISTS "GamePreparation_tenant_rule_fkey";
ALTER TABLE "GameResult" DROP CONSTRAINT IF EXISTS "GameResult_tenant_rule_fkey";
ALTER TABLE "Device" DROP CONSTRAINT IF EXISTS "Device_institutionId_fkey";

DROP INDEX IF EXISTS "GameSession_reservation_holder_key";
DROP INDEX IF EXISTS "GamePreparation_tenant_device_key";
DROP INDEX IF EXISTS "GamePreparation_session_source_key";
DROP INDEX IF EXISTS "GameRuleVersion_tenant_mode_key";

CREATE UNIQUE INDEX "GameRuleVersion_mode_key" ON "GameRuleVersion"("id", "mode");
CREATE UNIQUE INDEX "GamePreparation_session_source_key" ON "GamePreparation"("id", "institutionId", "mode", "ruleVersionId", "ownerSessionId");

ALTER TABLE "GamePreparation" ADD CONSTRAINT "GamePreparation_mode_rule_fkey" FOREIGN KEY ("ruleVersionId", "mode") REFERENCES "GameRuleVersion"("id", "mode") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "GameSession" ADD CONSTRAINT "GameSession_preparation_source_fkey" FOREIGN KEY ("preparationId", "institutionId", "mode", "ruleVersionId", "ownerSessionId") REFERENCES "GamePreparation"("id", "institutionId", "mode", "ruleVersionId", "ownerSessionId") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "GameSession" ADD CONSTRAINT "GameSession_mode_rule_fkey" FOREIGN KEY ("ruleVersionId", "mode") REFERENCES "GameRuleVersion"("id", "mode") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "GameResult" ADD CONSTRAINT "GameResult_mode_rule_fkey" FOREIGN KEY ("ruleVersionId", "mode") REFERENCES "GameRuleVersion"("id", "mode") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "GameSession" DROP COLUMN IF EXISTS "deviceId", DROP COLUMN IF EXISTS "reservationId";
ALTER TABLE "GamePreparation" DROP COLUMN IF EXISTS "deviceId";

DROP TABLE IF EXISTS "DeviceCommand";
DROP TABLE IF EXISTS "DeviceReservation";
DROP TABLE IF EXISTS "Device";

DROP TYPE IF EXISTS "CommandStatus";
DROP TYPE IF EXISTS "CommandKind";
DROP TYPE IF EXISTS "ReservationState";
DROP TYPE IF EXISTS "ReservationHolderType";
DROP TYPE IF EXISTS "DeviceInventoryStatus";
