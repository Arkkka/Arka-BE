-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "InstitutionStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "ParticipantStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "DeviceInventoryStatus" AS ENUM ('ACTIVE', 'RETIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "ReservationHolderType" AS ENUM ('PREPARATION', 'SESSION');

-- CreateEnum
CREATE TYPE "ReservationState" AS ENUM ('HELD', 'RELEASING');

-- CreateEnum
CREATE TYPE "GameMode" AS ENUM ('MOTOR_GRIP', 'GO_NO_GO', 'SEQUENCE_MEMORY');

-- CreateEnum
CREATE TYPE "PreparationState" AS ENUM ('WAITING_DEVICE', 'BINDING_SETUP', 'CALIBRATING', 'PRACTICING', 'READY', 'CANCELLED', 'EXPIRED', 'CONSUMED');

-- CreateEnum
CREATE TYPE "GameSessionStatus" AS ENUM ('BINDING', 'COUNTDOWN', 'PLAYING', 'PAUSED', 'ABORTED', 'INTERRUPTED', 'COMPLETED', 'SAVING', 'SAVED', 'SAVE_FAILED');

-- CreateEnum
CREATE TYPE "AiSummaryStatus" AS ENUM ('PENDING', 'PROCESSING', 'READY', 'UNAVAILABLE');

-- CreateEnum
CREATE TYPE "CommandKind" AS ENUM ('SETUP_BIND', 'SETUP_UNBIND', 'SESSION_BIND', 'SESSION_UNBIND', 'FEEDBACK');

-- CreateEnum
CREATE TYPE "CommandStatus" AS ENUM ('PENDING', 'SENT', 'ACKED', 'NACKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'DELIVERED', 'FAILED');

-- CreateTable
CREATE TABLE "Institution" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "status" "InstitutionStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Institution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "institutionId" UUID NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Participant" (
    "id" UUID NOT NULL,
    "participantId" VARCHAR(128) NOT NULL,
    "institutionId" UUID NOT NULL,
    "participantReference" VARCHAR(64) NOT NULL,
    "displayName" VARCHAR(100) NOT NULL,
    "normalizedName" VARCHAR(100) NOT NULL,
    "status" "ParticipantStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Participant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Device" (
    "deviceId" VARCHAR(80) NOT NULL,
    "institutionId" UUID NOT NULL,
    "label" VARCHAR(100) NOT NULL,
    "inventoryStatus" "DeviceInventoryStatus" NOT NULL DEFAULT 'ACTIVE',
    "credentialCiphertext" BYTEA NOT NULL,
    "credentialKeyVersion" INTEGER NOT NULL DEFAULT 1,
    "firmwareVersion" VARCHAR(80),
    "capabilitySnapshot" JSONB NOT NULL DEFAULT '[]',
    "provisionedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "credentialRotatedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "lastAuthenticatedAt" TIMESTAMP(3),

    CONSTRAINT "Device_pkey" PRIMARY KEY ("deviceId")
);

-- CreateTable
CREATE TABLE "DeviceReservation" (
    "deviceId" VARCHAR(80) NOT NULL,
    "reservationId" UUID NOT NULL,
    "institutionId" UUID NOT NULL,
    "holderType" "ReservationHolderType" NOT NULL,
    "preparationId" UUID,
    "sessionId" UUID,
    "state" "ReservationState" NOT NULL DEFAULT 'HELD',
    "releaseCommandId" UUID,
    "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeviceReservation_holder_check" CHECK (
        ("holderType" = 'PREPARATION' AND "preparationId" IS NOT NULL AND "sessionId" IS NULL)
        OR
        ("holderType" = 'SESSION' AND "sessionId" IS NOT NULL AND "preparationId" IS NULL)
    ),
    CONSTRAINT "DeviceReservation_pkey" PRIMARY KEY ("deviceId")
);

-- CreateTable
CREATE TABLE "GameRuleVersion" (
    "id" UUID NOT NULL,
    "institutionId" UUID NOT NULL,
    "mode" "GameMode" NOT NULL,
    "version" VARCHAR(80) NOT NULL,
    "config" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameRuleVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GamePreparation" (
    "id" UUID NOT NULL,
    "preparationId" VARCHAR(128) NOT NULL,
    "setupId" UUID NOT NULL,
    "institutionId" UUID NOT NULL,
    "ownerSessionId" VARCHAR(191) NOT NULL,
    "participantId" UUID,
    "displayNameSnapshot" VARCHAR(100) NOT NULL,
    "participantRefSnapshot" VARCHAR(64),
    "mode" "GameMode" NOT NULL,
    "deviceId" VARCHAR(80) NOT NULL,
    "ruleVersionId" UUID NOT NULL,
    "configSnapshot" JSONB NOT NULL,
    "firmwareSnapshot" JSONB,
    "capabilitySnapshot" JSONB NOT NULL,
    "calibrationSnapshot" JSONB,
    "state" "PreparationState" NOT NULL DEFAULT 'WAITING_DEVICE',
    "setupBoundAt" TIMESTAMP(3),
    "practiceCompletedAt" TIMESTAMP(3),
    "privacyAcknowledgedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GamePreparation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionCreationRequest" (
    "id" UUID NOT NULL,
    "ownerSessionId" VARCHAR(191) NOT NULL,
    "idempotencyKey" VARCHAR(128) NOT NULL,
    "requestFingerprint" CHAR(64) NOT NULL,
    "responseSnapshot" JSONB NOT NULL,
    "sessionId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SessionCreationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameSession" (
    "id" UUID NOT NULL,
    "institutionId" UUID NOT NULL,
    "ownerSessionId" VARCHAR(191) NOT NULL,
    "participantId" UUID,
    "preparationId" UUID NOT NULL,
    "displayNameSnapshot" VARCHAR(100) NOT NULL,
    "mode" "GameMode" NOT NULL,
    "deviceId" VARCHAR(80) NOT NULL,
    "reservationId" UUID NOT NULL,
    "ruleVersionId" UUID NOT NULL,
    "configSnapshot" JSONB NOT NULL,
    "firmwareSnapshot" JSONB,
    "capabilitySnapshot" JSONB NOT NULL,
    "calibrationSnapshot" JSONB,
    "gameRuleVersionSnapshot" VARCHAR(80) NOT NULL,
    "status" "GameSessionStatus" NOT NULL DEFAULT 'BINDING',
    "bindingDeadlineAt" TIMESTAMP(3) NOT NULL,
    "sessionBoundAt" TIMESTAMP(3),
    "companionArrivedAt" TIMESTAMP(3),
    "activationId" UUID,
    "activationSnapshot" JSONB,
    "countdownEndsAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "pausedAt" TIMESTAMP(3),
    "pausedState" JSONB,
    "completedAt" TIMESTAMP(3),
    "terminalReason" VARCHAR(100),
    "finalizationRecoveryExpiresAt" TIMESTAMP(3),
    "finalizationLeaseToken" UUID,
    "finalizationLeaseExpiresAt" TIMESTAMP(3),
    "finalizationFailedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GameSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameResult" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "institutionId" UUID NOT NULL,
    "participantId" UUID,
    "mode" "GameMode" NOT NULL,
    "ruleVersionId" UUID NOT NULL,
    "gameRuleVersion" VARCHAR(80) NOT NULL,
    "score" INTEGER NOT NULL,
    "metrics" JSONB NOT NULL,
    "calibrationContext" JSONB,
    "deviceSnapshot" JSONB NOT NULL,
    "browserSnapshot" JSONB,
    "lifecycleTrace" JSONB NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL,
    "savedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameTrial" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "trialIndex" INTEGER NOT NULL,
    "attemptIndex" INTEGER NOT NULL DEFAULT 0,
    "kind" VARCHAR(40) NOT NULL,
    "payload" JSONB NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameTrial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiSessionSummary" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "status" "AiSummaryStatus" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "leaseToken" UUID,
    "leaseExpiresAt" TIMESTAMP(3),
    "summaryText" VARCHAR(280),
    "observations" JSONB,
    "unavailableReason" VARCHAR(80),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiSessionSummary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceCommand" (
    "id" UUID NOT NULL,
    "commandId" UUID NOT NULL,
    "deviceId" VARCHAR(80) NOT NULL,
    "reservationId" UUID,
    "sessionId" UUID,
    "associationId" UUID,
    "kind" "CommandKind" NOT NULL,
    "sequence" BIGINT NOT NULL,
    "connectionId" UUID,
    "bootId" UUID,
    "status" "CommandStatus" NOT NULL DEFAULT 'PENDING',
    "payload" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),
    "nackReason" VARCHAR(80),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceCommand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "institutionId" UUID,
    "actorUserId" VARCHAR(191),
    "actorSessionId" VARCHAR(191),
    "action" VARCHAR(80) NOT NULL,
    "targetType" VARCHAR(60),
    "targetId" VARCHAR(191),
    "outcome" VARCHAR(40) NOT NULL,
    "requestId" UUID,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboxEvent" (
    "id" UUID NOT NULL,
    "eventKey" VARCHAR(191) NOT NULL,
    "type" VARCHAR(80) NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "leaseToken" UUID,
    "leaseExpiresAt" TIMESTAMP(3),
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),
    "lastErrorCode" VARCHAR(80),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Institution_status_idx" ON "Institution"("status");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_institutionId_key" ON "User"("institutionId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_token_key" ON "Session"("token");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Account_userId_idx" ON "Account"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_providerId_accountId_key" ON "Account"("providerId", "accountId");

-- CreateIndex
CREATE INDEX "Verification_identifier_idx" ON "Verification"("identifier");

-- CreateIndex
CREATE UNIQUE INDEX "Participant_participantId_key" ON "Participant"("participantId");

-- CreateIndex
CREATE INDEX "Participant_institutionId_status_idx" ON "Participant"("institutionId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Participant_institutionId_participantReference_key" ON "Participant"("institutionId", "participantReference");

-- CreateIndex
CREATE INDEX "Device_institutionId_inventoryStatus_idx" ON "Device"("institutionId", "inventoryStatus");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceReservation_reservationId_key" ON "DeviceReservation"("reservationId");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceReservation_preparationId_key" ON "DeviceReservation"("preparationId");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceReservation_sessionId_key" ON "DeviceReservation"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceReservation_releaseCommandId_key" ON "DeviceReservation"("releaseCommandId");

-- CreateIndex
CREATE INDEX "DeviceReservation_institutionId_state_idx" ON "DeviceReservation"("institutionId", "state");

-- CreateIndex
CREATE INDEX "GameRuleVersion_institutionId_mode_isActive_idx" ON "GameRuleVersion"("institutionId", "mode", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "GameRuleVersion_institutionId_mode_version_key" ON "GameRuleVersion"("institutionId", "mode", "version");

-- CreateIndex
CREATE UNIQUE INDEX "GamePreparation_preparationId_key" ON "GamePreparation"("preparationId");

-- CreateIndex
CREATE UNIQUE INDEX "GamePreparation_setupId_key" ON "GamePreparation"("setupId");

-- CreateIndex
CREATE INDEX "GamePreparation_institutionId_ownerSessionId_state_idx" ON "GamePreparation"("institutionId", "ownerSessionId", "state");

-- CreateIndex
CREATE INDEX "GamePreparation_expiresAt_state_idx" ON "GamePreparation"("expiresAt", "state");

-- CreateIndex
CREATE UNIQUE INDEX "SessionCreationRequest_sessionId_key" ON "SessionCreationRequest"("sessionId");

-- CreateIndex
CREATE INDEX "SessionCreationRequest_expiresAt_idx" ON "SessionCreationRequest"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "SessionCreationRequest_ownerSessionId_idempotencyKey_key" ON "SessionCreationRequest"("ownerSessionId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "GameSession_activationId_key" ON "GameSession"("activationId");

-- CreateIndex
CREATE INDEX "GameSession_institutionId_participantId_completedAt_idx" ON "GameSession"("institutionId", "participantId", "completedAt");

-- CreateIndex
CREATE INDEX "GameSession_status_finalizationRecoveryExpiresAt_idx" ON "GameSession"("status", "finalizationRecoveryExpiresAt");

-- CreateIndex
CREATE INDEX "GameSession_ownerSessionId_status_idx" ON "GameSession"("ownerSessionId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "GameResult_sessionId_key" ON "GameResult"("sessionId");

-- CreateIndex
CREATE INDEX "GameResult_institutionId_participantId_mode_gameRuleVersion_idx" ON "GameResult"("institutionId", "participantId", "mode", "gameRuleVersion", "score", "completedAt");

-- CreateIndex
CREATE INDEX "GameTrial_sessionId_idx" ON "GameTrial"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "GameTrial_sessionId_trialIndex_attemptIndex_key" ON "GameTrial"("sessionId", "trialIndex", "attemptIndex");

-- CreateIndex
CREATE UNIQUE INDEX "AiSessionSummary_sessionId_key" ON "AiSessionSummary"("sessionId");

-- CreateIndex
CREATE INDEX "AiSessionSummary_status_leaseExpiresAt_idx" ON "AiSessionSummary"("status", "leaseExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceCommand_commandId_key" ON "DeviceCommand"("commandId");

-- CreateIndex
CREATE INDEX "DeviceCommand_deviceId_status_expiresAt_idx" ON "DeviceCommand"("deviceId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "DeviceCommand_sessionId_idx" ON "DeviceCommand"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceCommand_deviceId_sequence_key" ON "DeviceCommand"("deviceId", "sequence");

-- CreateIndex
CREATE INDEX "AuditLog_institutionId_createdAt_idx" ON "AuditLog"("institutionId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "OutboxEvent_eventKey_key" ON "OutboxEvent"("eventKey");

-- CreateIndex
CREATE INDEX "OutboxEvent_status_availableAt_leaseExpiresAt_idx" ON "OutboxEvent"("status", "availableAt", "leaseExpiresAt");

-- Tenant-scoped identities used by composite foreign keys below.
CREATE UNIQUE INDEX "Participant_tenant_identity_key" ON "Participant"("id", "institutionId");
CREATE UNIQUE INDEX "Device_tenant_identity_key" ON "Device"("deviceId", "institutionId");
CREATE UNIQUE INDEX "GameRuleVersion_tenant_mode_key" ON "GameRuleVersion"("id", "institutionId", "mode");
CREATE UNIQUE INDEX "GamePreparation_tenant_device_key" ON "GamePreparation"("id", "institutionId", "deviceId");
CREATE UNIQUE INDEX "GamePreparation_session_source_key" ON "GamePreparation"("id", "institutionId", "deviceId", "mode", "ruleVersionId", "ownerSessionId");
CREATE UNIQUE INDEX "GameSession_reservation_holder_key" ON "GameSession"("id", "institutionId", "deviceId", "reservationId");
CREATE UNIQUE INDEX "GameSession_result_source_key" ON "GameSession"("id", "institutionId", "mode", "ruleVersionId");

-- AddForeignKey: direct SQL writes cannot cross institution or mode boundaries.
ALTER TABLE "DeviceReservation" ADD CONSTRAINT "DeviceReservation_tenant_device_fkey" FOREIGN KEY ("deviceId", "institutionId") REFERENCES "Device"("deviceId", "institutionId") ON DELETE CASCADE ON UPDATE RESTRICT;
ALTER TABLE "DeviceReservation" ADD CONSTRAINT "DeviceReservation_tenant_preparation_fkey" FOREIGN KEY ("preparationId", "institutionId", "deviceId") REFERENCES "GamePreparation"("id", "institutionId", "deviceId") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "DeviceReservation" ADD CONSTRAINT "DeviceReservation_tenant_session_fkey" FOREIGN KEY ("sessionId", "institutionId", "deviceId", "reservationId") REFERENCES "GameSession"("id", "institutionId", "deviceId", "reservationId") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "GamePreparation" ADD CONSTRAINT "GamePreparation_tenant_participant_fkey" FOREIGN KEY ("participantId", "institutionId") REFERENCES "Participant"("id", "institutionId") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "GamePreparation" ADD CONSTRAINT "GamePreparation_tenant_device_fkey" FOREIGN KEY ("deviceId", "institutionId") REFERENCES "Device"("deviceId", "institutionId") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "GamePreparation" ADD CONSTRAINT "GamePreparation_tenant_rule_fkey" FOREIGN KEY ("ruleVersionId", "institutionId", "mode") REFERENCES "GameRuleVersion"("id", "institutionId", "mode") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "GameSession" ADD CONSTRAINT "GameSession_tenant_participant_fkey" FOREIGN KEY ("participantId", "institutionId") REFERENCES "Participant"("id", "institutionId") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "GameSession" ADD CONSTRAINT "GameSession_preparation_source_fkey" FOREIGN KEY ("preparationId", "institutionId", "deviceId", "mode", "ruleVersionId", "ownerSessionId") REFERENCES "GamePreparation"("id", "institutionId", "deviceId", "mode", "ruleVersionId", "ownerSessionId") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "GameSession" ADD CONSTRAINT "GameSession_tenant_device_fkey" FOREIGN KEY ("deviceId", "institutionId") REFERENCES "Device"("deviceId", "institutionId") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "GameSession" ADD CONSTRAINT "GameSession_tenant_rule_fkey" FOREIGN KEY ("ruleVersionId", "institutionId", "mode") REFERENCES "GameRuleVersion"("id", "institutionId", "mode") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "GameResult" ADD CONSTRAINT "GameResult_session_source_fkey" FOREIGN KEY ("sessionId", "institutionId", "mode", "ruleVersionId") REFERENCES "GameSession"("id", "institutionId", "mode", "ruleVersionId") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "GameResult" ADD CONSTRAINT "GameResult_tenant_participant_fkey" FOREIGN KEY ("participantId", "institutionId") REFERENCES "Participant"("id", "institutionId") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "GameResult" ADD CONSTRAINT "GameResult_tenant_rule_fkey" FOREIGN KEY ("ruleVersionId", "institutionId", "mode") REFERENCES "GameRuleVersion"("id", "institutionId", "mode") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Participant" ADD CONSTRAINT "Participant_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceReservation" ADD CONSTRAINT "DeviceReservation_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("deviceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceReservation" ADD CONSTRAINT "DeviceReservation_preparationId_fkey" FOREIGN KEY ("preparationId") REFERENCES "GamePreparation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceReservation" ADD CONSTRAINT "DeviceReservation_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "GameSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameRuleVersion" ADD CONSTRAINT "GameRuleVersion_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GamePreparation" ADD CONSTRAINT "GamePreparation_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GamePreparation" ADD CONSTRAINT "GamePreparation_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GamePreparation" ADD CONSTRAINT "GamePreparation_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("deviceId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GamePreparation" ADD CONSTRAINT "GamePreparation_ruleVersionId_fkey" FOREIGN KEY ("ruleVersionId") REFERENCES "GameRuleVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionCreationRequest" ADD CONSTRAINT "SessionCreationRequest_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "GameSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameSession" ADD CONSTRAINT "GameSession_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameSession" ADD CONSTRAINT "GameSession_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameSession" ADD CONSTRAINT "GameSession_preparationId_fkey" FOREIGN KEY ("preparationId") REFERENCES "GamePreparation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameSession" ADD CONSTRAINT "GameSession_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("deviceId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameSession" ADD CONSTRAINT "GameSession_ruleVersionId_fkey" FOREIGN KEY ("ruleVersionId") REFERENCES "GameRuleVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameResult" ADD CONSTRAINT "GameResult_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "GameSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameResult" ADD CONSTRAINT "GameResult_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameResult" ADD CONSTRAINT "GameResult_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameResult" ADD CONSTRAINT "GameResult_ruleVersionId_fkey" FOREIGN KEY ("ruleVersionId") REFERENCES "GameRuleVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameTrial" ADD CONSTRAINT "GameTrial_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "GameSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiSessionSummary" ADD CONSTRAINT "AiSessionSummary_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "GameSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceCommand" ADD CONSTRAINT "DeviceCommand_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("deviceId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceCommand" ADD CONSTRAINT "DeviceCommand_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "GameSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE SET NULL ON UPDATE CASCADE;
