import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  GameMetricsSchema,
  HistoryPageDtoSchema,
  LeaderboardDtoSchema,
  ParticipantDetailDtoSchema,
  ParticipantDtoSchema,
  ResolveParticipantResponseSchema,
  type GameMetrics,
  type GameMode,
  type HistoryPageDto,
  type LeaderboardDto,
  type ParticipantDetailDto,
  type ParticipantDto,
} from '../../schemas/index.js';
import { z } from 'zod';
import { AppError } from '../../middleware/errors.js';
import type { AuditContext } from '../../services/audit.js';
import type {
  ParticipantRepository,
  ParticipantRecord,
  ParticipantUpdateData,
} from './participant.repository.js';

const PAGE_SIZE = 10;
const cursorPayloadSchema = z.object({ at: z.string().datetime(), id: z.string().uuid() });
type HistoryCursor = z.infer<typeof cursorPayloadSchema>;

export interface ParticipantScope extends AuditContext {
  readonly institutionId: string;
  readonly actorUserId: string;
  readonly actorSessionId: string;
  readonly requestId: string;
}

export interface ParticipantIdentityInput {
  readonly displayName: string;
  readonly participantReference: string;
}

export interface ParticipantChanges {
  readonly displayName?: string | undefined;
  readonly image?: string | null | undefined;
  readonly dateOfBirth?: string | null | undefined;
  readonly gender?: 'MALE' | 'FEMALE' | null | undefined;
  readonly participantReference?: string | undefined;
  readonly status?: 'ACTIVE' | 'INACTIVE' | undefined;
}

export interface HistoryFilters {
  readonly mode?: GameMode | undefined;
  readonly ruleVersion?: string | undefined;
  readonly cursor?: string | undefined;
}

function participantDto(participant: ParticipantRecord): ParticipantDto {
  return ParticipantDtoSchema.parse({
    participantId: participant.participantId,
    displayName: participant.displayName,
    image: participant.image,
    dateOfBirth: participant.dateOfBirth?.toISOString().slice(0, 10) ?? null,
    gender: participant.gender,
    participantReference: participant.participantReference,
    status: participant.status,
    createdAt: participant.createdAt.toISOString(),
    updatedAt: participant.updatedAt.toISOString(),
  });
}

function normalizeDisplayName(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('id-ID');
}

function average(values: readonly number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function overallMetrics(mode: GameMode, results: readonly { score: number; metrics: unknown }[]) {
  const parsed = results.flatMap((result) => {
    const metrics = GameMetricsSchema.safeParse(result.metrics);
    return metrics.success && metrics.data.mode === mode ? [{ score: result.score, metrics: metrics.data }] : [];
  });
  if (parsed.length === 0) return null;
  const averageScore = Math.round(average(parsed.map((result) => result.score)) ?? 0);
  if (mode === 'MOTOR_GRIP') {
    const metrics = parsed.map((result) => result.metrics).filter((value): value is Extract<GameMetrics, { mode: 'MOTOR_GRIP' }> => value.mode === 'MOTOR_GRIP');
    return {
      mode,
      averageScore,
      averagePeakKilograms: average(metrics.map((value) => value.peakKilograms)) ?? 0,
      averageKilograms: average(metrics.map((value) => value.averageKilograms)) ?? 0,
      averageContinuousHoldMs: average(metrics.map((value) => value.continuousHoldMs)) ?? 0,
    };
  }
  if (mode === 'GO_NO_GO') {
    const metrics = parsed.map((result) => result.metrics).filter((value): value is Extract<GameMetrics, { mode: 'GO_NO_GO' }> => value.mode === 'GO_NO_GO');
    return {
      mode,
      averageScore,
      averageAccuracyPercent: average(metrics.map((value) => value.accuracyPercent)) ?? 0,
      averageReactionMs: average(metrics.flatMap((value) => value.meanHitReactionMs === null ? [] : [value.meanHitReactionMs])),
      totalTrials: metrics.reduce((sum, value) => sum + value.totalTrials, 0),
      totalHits: metrics.reduce((sum, value) => sum + value.hits, 0),
      totalMisses: metrics.reduce((sum, value) => sum + value.misses, 0),
      totalFalsePositives: metrics.reduce((sum, value) => sum + value.falsePositives, 0),
      totalCorrectRejections: metrics.reduce((sum, value) => sum + value.correctRejections, 0),
    };
  }
  const metrics = parsed.map((result) => result.metrics).filter((value): value is Extract<GameMetrics, { mode: 'SEQUENCE_MEMORY' }> => value.mode === 'SEQUENCE_MEMORY');
  const levels = Array.from({ length: 6 }, (_, index) => index + 1).flatMap((level) => {
    const values = metrics.flatMap((value) => value.levelLatencies.filter((point) => point.level === level).map((point) => point.latencyMs));
    const latencyMs = average(values);
    return latencyMs === null ? [] : [{ level, latencyMs, samples: values.length }];
  });
  return {
    mode,
    averageScore,
    averageMemorySpan: average(metrics.map((value) => value.maxSequenceLength)) ?? 0,
    averageFirstResponseMs: average(metrics.flatMap((value) => value.meanFirstResponseMs === null ? [] : [value.meanFirstResponseMs])),
    levelLatencies: levels,
  };
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

export class ParticipantService {
  public constructor(
    private readonly repository: ParticipantRepository,
    private readonly cursorSecret: string,
  ) {}

  public async resolveParticipant(
    scope: ParticipantScope,
    participantReference: string,
  ): Promise<{ participantId: string }> {
    const participant = await this.repository.findByReference(
      scope.institutionId,
      participantReference,
    );
    if (!participant) throw new AppError(404, 'participant_not_found', 'Peserta tidak ditemukan.');
    await this.repository.recordResolved(scope, participant.participantId);
    return ResolveParticipantResponseSchema.parse(participant);
  }

  public async searchParticipants(
    institutionId: string,
    query: string,
  ): Promise<ParticipantDto[]> {
    const participants = await this.repository.searchActive(
      institutionId,
      normalizeDisplayName(query),
      query.trim(),
      20,
    );
    return participants.map(participantDto);
  }

  public async createParticipant(
    scope: ParticipantScope,
    input: { readonly displayName: string; readonly dateOfBirth?: string | null | undefined; readonly gender?: 'MALE' | 'FEMALE' | null | undefined },
  ): Promise<ParticipantDto> {
    const normalizedName = normalizeDisplayName(input.displayName);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const participant = await this.repository.createWithAudit(scope, {
          displayName: input.displayName,
          normalizedName,
          participantReference: `AUTO-${randomBytes(9).toString('base64url')}`,
          dateOfBirth: input.dateOfBirth ? new Date(`${input.dateOfBirth}T00:00:00.000Z`) : null,
          gender: input.gender ?? null,
        });
        return participantDto(participant);
      } catch (error) {
        if (!isUniqueConstraintError(error) || attempt === 2) throw error;
      }
    }
    throw new AppError(500, 'participant_creation_failed', 'Peserta belum dapat dibuat.');
  }

  public async getParticipant(
    institutionId: string,
    participantHandle: string,
  ): Promise<ParticipantDetailDto> {
    const participant = await this.repository.findByHandle(institutionId, participantHandle);
    if (!participant) throw new AppError(404, 'participant_not_found', 'Peserta tidak ditemukan.');
    const [modeSummaries, aggregateSummary, narrativeSummaries] = await Promise.all([
      this.repository.modeSummaries(institutionId, participant.id),
      this.repository.participantSummary(institutionId, participant.id),
      this.repository.participantModeSummaries(institutionId, participant.id),
    ]);
    return ParticipantDetailDtoSchema.parse({
      ...participantDto(participant),
      aggregateSummary: aggregateSummary
        ? {
            ...aggregateSummary,
            updatedAt: aggregateSummary.updatedAt.toISOString(),
          }
        : null,
      modeSummaries: modeSummaries.map((summary) => ({
        mode: summary.mode,
        savedSessionsTotal: summary.savedSessionsTotal,
        latestSession: summary.latestSession
          ? {
              sessionId: summary.latestSession.sessionId,
              score: summary.latestSession.score,
              completedAt: summary.latestSession.completedAt.toISOString(),
              gameRuleVersion: summary.latestSession.gameRuleVersion,
            }
          : null,
        overallMetrics: overallMetrics(summary.mode, summary.results),
        narrativeSummary: (() => {
          const narrative = narrativeSummaries.find((item) => item.mode === summary.mode);
          return narrative
            ? {
                participantSummary: narrative.participantSummary,
                clinicianSummary: narrative.clinicianSummary,
                source: narrative.source,
                updatedAt: narrative.updatedAt.toISOString(),
              }
            : null;
        })(),
      })),
    });
  }

  public async updateParticipant(
    scope: ParticipantScope,
    participantHandle: string,
    changes: ParticipantChanges,
  ): Promise<ParticipantDto> {
    const data: ParticipantUpdateData = {
      ...(changes.displayName === undefined
        ? {}
        : {
            displayName: changes.displayName,
            normalizedName: normalizeDisplayName(changes.displayName),
          }),
       ...(changes.image === undefined ? {} : { image: changes.image }),
       ...(changes.dateOfBirth === undefined ? {} : { dateOfBirth: changes.dateOfBirth ? new Date(`${changes.dateOfBirth}T00:00:00.000Z`) : null }),
       ...(changes.gender === undefined ? {} : { gender: changes.gender }),
       ...(changes.participantReference === undefined
         ? {}
         : { participantReference: changes.participantReference }),
      ...(changes.status === undefined ? {} : { status: changes.status }),
    };
    let participant: ParticipantRecord | null;
    try {
      participant = await this.repository.updateWithAudit(
        scope,
        participantHandle,
        data,
        Object.keys(changes),
      );
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new AppError(409, 'participant_reference_conflict', 'Kode peserta sudah digunakan.');
      }
      throw error;
    }
    if (!participant) throw new AppError(404, 'participant_not_found', 'Peserta tidak ditemukan.');
    return participantDto(participant);
  }

  public async participantHistory(
    institutionId: string,
    participantHandle: string,
    filters: HistoryFilters,
  ): Promise<HistoryPageDto> {
    const participantId = await this.participantPrimaryKey(institutionId, participantHandle);
    const cursor = filters.cursor ? this.decodeCursor(filters.cursor) : null;
    const baseFilters = {
      ...(filters.mode ? { mode: filters.mode } : {}),
      ...(filters.ruleVersion ? { ruleVersion: filters.ruleVersion } : {}),
    };
    const [sessions, totalItems] = await Promise.all([
      this.repository.listSessions(
        institutionId,
        participantId,
        {
          ...baseFilters,
          ...(cursor ? { before: { at: new Date(cursor.at), id: cursor.id } } : {}),
        },
        PAGE_SIZE + 1,
      ),
      this.repository.countSessions(institutionId, participantId, baseFilters),
    ]);
    const page = sessions.slice(0, PAGE_SIZE);
    const last = page.at(-1);
    return HistoryPageDtoSchema.parse({
      items: page.map((session) => ({
        sessionId: session.id,
        mode: session.mode,
        status: session.status,
        startedAt: session.startedAt?.toISOString() ?? null,
        completedAt: session.completedAt?.toISOString() ?? null,
        score: session.result?.score ?? null,
        gameRuleVersion: session.result?.gameRuleVersion ?? null,
        metrics: session.result?.metrics ?? null,
      })),
      nextCursor:
        sessions.length > PAGE_SIZE && last
          ? this.encodeCursor({ at: last.createdAt.toISOString(), id: last.id })
          : null,
      totalItems,
      totalPages: Math.ceil(totalItems / PAGE_SIZE),
    });
  }

  public async participantLeaderboard(
    institutionId: string,
    participantHandle: string,
    mode: GameMode,
    ruleVersion: string,
  ): Promise<LeaderboardDto> {
    const participantId = await this.participantPrimaryKey(institutionId, participantHandle);
    const results = await this.repository.listLeaderboard(
      institutionId,
      participantId,
      mode,
      ruleVersion,
    );
    return LeaderboardDtoSchema.parse({
      participantId: participantHandle,
      mode,
      ruleVersion,
      entries: results.map((result, index) => ({
        rank: index + 1,
        sessionId: result.sessionId,
        completedAt: result.completedAt.toISOString(),
        score: result.score,
        metrics: result.metrics,
      })),
    });
  }

  public async ensureActiveParticipant(
    institutionId: string,
    input: ParticipantIdentityInput,
  ): Promise<{ id: string; participantId: string }> {
    const participant = await this.repository.ensureActiveParticipant(institutionId, {
      ...input,
      normalizedName: normalizeDisplayName(input.displayName),
    });
    if (participant.status === 'INACTIVE') {
      throw new AppError(409, 'participant_inactive', 'Profil peserta tidak aktif.');
    }
    return { id: participant.id, participantId: participant.participantId };
  }

  private async participantPrimaryKey(
    institutionId: string,
    participantHandle: string,
  ): Promise<string> {
    const participant = await this.repository.findPrimaryKey(institutionId, participantHandle);
    if (!participant) throw new AppError(404, 'participant_not_found', 'Peserta tidak ditemukan.');
    return participant.id;
  }

  private encodeCursor(cursor: HistoryCursor): string {
    const payload = Buffer.from(JSON.stringify(cursor)).toString('base64url');
    const signature = createHmac('sha256', this.cursorSecret).update(payload).digest('base64url');
    return `${payload}.${signature}`;
  }

  private decodeCursor(cursor: string): HistoryCursor {
    const [payload, supplied, extra] = cursor.split('.');
    if (!payload || !supplied || extra) this.invalidCursor();
    const expected = createHmac('sha256', this.cursorSecret).update(payload).digest();
    let actual: Buffer;
    try {
      actual = Buffer.from(supplied, 'base64url');
    } catch {
      return this.invalidCursor();
    }
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      return this.invalidCursor();
    }
    try {
      return cursorPayloadSchema.parse(
        JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')),
      );
    } catch {
      return this.invalidCursor();
    }
  }

  private invalidCursor(): never {
    throw new AppError(400, 'invalid_cursor', 'Cursor riwayat tidak valid.');
  }
}
