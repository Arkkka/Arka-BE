import { createHash } from 'node:crypto';
import {
  GameSessionDtoSchema,
  mapStoredAiSummary,
  type CreateGameSessionResponse,
  type GameSessionDto,
  type PreparationDto,
} from '../../schemas/index.js';
import { AppError } from '../../middleware/errors.js';
import type { RuntimeGateway } from '../../realtime/index.js';
import type { AuditContext, AuditEvent } from '../../services/audit.js';
import type { GameRepository, PersistedGameSession } from './game.repository.js';
import type {
  CreateGameSessionRequest,
  CreatePreparationRequest,
  PreparationStatusPatchRequest,
  SessionStatusPatchRequest,
} from './game.validation.js';

export interface GameRequestContext {
  readonly institutionId: string;
  readonly userId: string;
  readonly ownerSessionId: string;
  readonly requestId: string;
}

export type GameAuditWriter = (context: AuditContext, event: AuditEvent) => Promise<void>;

function auditContext(context: GameRequestContext): AuditContext {
  return {
    institutionId: context.institutionId,
    actorUserId: context.userId,
    actorSessionId: context.ownerSessionId,
    requestId: context.requestId,
  };
}

export function mapGameSession(session: PersistedGameSession): GameSessionDto {
  const aiSummary = session.result
    ? mapStoredAiSummary(
        session.aiSummary?.status,
        session.aiSummary?.summaryText,
        session.aiSummary?.observations,
      )
    : null;

  return GameSessionDtoSchema.parse({
    sessionId: session.id,
    status: session.status,
    mode: session.mode,
    displayName: session.displayNameSnapshot,
    participantId: session.participant?.participantId ?? null,
    startedAt: session.startedAt?.toISOString() ?? null,
    completedAt: session.completedAt?.toISOString() ?? null,
    failureReason: session.terminalReason,
    result: session.result
      ? {
          score: session.result.score,
          metrics: session.result.metrics,
          gameRuleVersion: session.gameRuleVersionSnapshot,
          savedAt: session.result.savedAt.toISOString(),
          aiSummary,
        }
      : null,
  });
}

export class GameService {
  constructor(
    private readonly repository: GameRepository,
    private readonly runtime: RuntimeGateway,
    private readonly writeAudit: GameAuditWriter,
  ) {}

  async openPreparation(
    context: GameRequestContext,
    request: CreatePreparationRequest,
  ): Promise<PreparationDto> {
    const participantStatus = request.participantReference
      ? await this.repository.findParticipantStatus(
          context.institutionId,
          request.participantReference,
        )
      : null;
    if (participantStatus === 'INACTIVE') {
      throw new AppError(409, 'participant_inactive', 'Profil peserta tidak aktif.');
    }

    const preparation = await this.runtime.openPreparation({
      institutionId: context.institutionId,
      ownerSessionId: context.ownerSessionId,
      userId: context.userId,
      requestId: context.requestId,
      mode: request.mode,
      displayName: request.displayName,
      privacyAcknowledged: request.privacyAcknowledged,
      ...(request.participantReference === undefined
        ? {}
        : { participantReference: request.participantReference }),
    });
    await this.writeAudit(auditContext(context), {
      action: 'PREPARATION_OPENED',
      targetType: 'GamePreparation',
      targetId: preparation.preparationId,
      metadata: { mode: preparation.mode },
    });
    return preparation;
  }

  async commandPreparation(
    context: GameRequestContext,
    preparationId: string,
    request: PreparationStatusPatchRequest,
  ): Promise<void> {
    if (request.command === 'CANCEL') {
      await this.runtime.cancelPreparation({
        institutionId: context.institutionId,
        ownerSessionId: context.ownerSessionId,
        preparationId,
      });
    }
    await this.writeAudit(auditContext(context), {
      action: `PREPARATION_${request.command}`,
      targetType: 'GamePreparation',
      targetId: preparationId,
    });
  }

  async createSession(
    context: GameRequestContext,
    request: CreateGameSessionRequest,
    idempotencyKey: string,
  ): Promise<CreateGameSessionResponse> {
    const requestFingerprint = createHash('sha256')
      .update(`create-game-session\0${request.preparationId}`)
      .digest('hex');
    const session = await this.runtime.createSession({
      institutionId: context.institutionId,
      ownerSessionId: context.ownerSessionId,
      userId: context.userId,
      requestId: context.requestId,
      preparationId: request.preparationId,
      idempotencyKey,
      requestFingerprint,
    });
    await this.writeAudit(auditContext(context), {
      action: 'GAME_SESSION_CREATED',
      targetType: 'GameSession',
      targetId: session.sessionId,
    });
    return session;
  }

  async commandSession(
    context: GameRequestContext,
    sessionId: string,
    request: SessionStatusPatchRequest,
  ): Promise<GameSessionDto> {
    const session = await this.runtime.commandSession({
      institutionId: context.institutionId,
      ownerSessionId: context.ownerSessionId,
      userId: context.userId,
      requestId: context.requestId,
      sessionId,
      command: request.command,
    });
    await this.writeAudit(auditContext(context), {
      action: `GAME_SESSION_${request.command}`,
      targetType: 'GameSession',
      targetId: sessionId,
    });
    return session;
  }

  async getSession(institutionId: string, sessionId: string): Promise<GameSessionDto> {
    const session = await this.repository.findSession(institutionId, sessionId);
    if (!session) throw new AppError(404, 'session_not_found', 'Sesi tidak ditemukan.');
    return mapGameSession(session);
  }
}
