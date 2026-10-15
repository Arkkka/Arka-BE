import { randomBytes } from 'node:crypto';
import type { GameMode } from '../../schemas/index.js';
import type { GameSessionStatus, Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { writeAudit, type AuditContext } from '../../services/audit.js';

export interface ParticipantRecord {
  readonly id: string;
  readonly participantId: string;
  readonly displayName: string;
  readonly image: string | null;
  readonly dateOfBirth: Date | null;
  readonly gender: 'MALE' | 'FEMALE' | null;
  readonly participantReference: string;
  readonly status: 'ACTIVE' | 'INACTIVE';
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface ParticipantUpdateData {
  readonly displayName?: string | undefined;
  readonly image?: string | null | undefined;
  readonly dateOfBirth?: Date | null | undefined;
  readonly gender?: 'MALE' | 'FEMALE' | null | undefined;
  readonly normalizedName?: string | undefined;
  readonly participantReference?: string | undefined;
  readonly status?: 'ACTIVE' | 'INACTIVE' | undefined;
}

export interface ParticipantHistoryFilters {
  readonly mode?: GameMode | undefined;
  readonly ruleVersion?: string | undefined;
  readonly before?: { readonly at: Date; readonly id: string } | undefined;
}

export interface ParticipantSessionRecord {
  readonly id: string;
  readonly mode: GameMode;
  readonly status: GameSessionStatus;
  readonly startedAt: Date | null;
  readonly completedAt: Date | null;
  readonly createdAt: Date;
  readonly result: {
    readonly score: number;
    readonly metrics: Prisma.JsonValue;
    readonly gameRuleVersion: string;
  } | null;
}

export interface ParticipantLeaderboardRecord {
  readonly sessionId: string;
  readonly completedAt: Date;
  readonly score: number;
  readonly metrics: Prisma.JsonValue;
}

export interface EnsuredParticipantRecord {
  readonly id: string;
  readonly participantId: string;
  readonly status: 'ACTIVE' | 'INACTIVE';
}

function publicHandle(): string {
  return randomBytes(24).toString('base64url');
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

export class ParticipantRepository {
  public constructor(private readonly prisma: PrismaClient) {}

  public findByReference(
    institutionId: string,
    participantReference: string,
  ): Promise<{ participantId: string } | null> {
    return this.prisma.msParticipant.findFirst({
      where: { institutionId, participantReference },
      select: { participantId: true },
    });
  }

  public findByHandle(
    institutionId: string,
    participantHandle: string,
  ): Promise<ParticipantRecord | null> {
    return this.prisma.msParticipant.findFirst({
      where: { institutionId, participantId: participantHandle },
    });
  }

  public participantModeSummaries(institutionId: string, participantId: string) {
    return this.prisma.trParticipantModeSummary.findMany({
      where: { institutionId, participantId },
      select: {
        mode: true,
        participantSummary: true,
        clinicianSummary: true,
        source: true,
        updatedAt: true,
      },
    });
  }

  public participantSummary(institutionId: string, participantId: string) {
    return this.prisma.trParticipantSummary.findFirst({
      where: { institutionId, participantId },
      select: {
        savedSessionsTotal: true,
        participantSummary: true,
        clinicianSummary: true,
        source: true,
        updatedAt: true,
      },
    });
  }

  public async modeSummaries(institutionId: string, participantId: string) {
    const modes: readonly GameMode[] = ['MOTOR_GRIP', 'GO_NO_GO', 'SEQUENCE_MEMORY'];
    return Promise.all(
      modes.map(async (mode) => {
        const where = {
          institutionId,
          participantId,
          mode,
          session: { institutionId, status: 'SAVED' as const },
        };
        const results = await this.prisma.trGameResult.findMany({
          where,
          orderBy: [{ completedAt: 'desc' }, { sessionId: 'desc' }],
          select: {
            sessionId: true,
            score: true,
            completedAt: true,
            gameRuleVersion: true,
            metrics: true,
          },
        });
        return {
          mode,
          savedSessionsTotal: results.length,
          latestSession: results[0] ?? null,
          results,
        };
      }),
    );
  }

  public findPrimaryKey(
    institutionId: string,
    participantHandle: string,
  ): Promise<{ id: string } | null> {
    return this.prisma.msParticipant.findFirst({
      where: { institutionId, participantId: participantHandle },
      select: { id: true },
    });
  }

  public async recordResolved(context: AuditContext, participantHandle: string): Promise<void> {
    await writeAudit(this.prisma, context, {
      action: 'PARTICIPANT_RESOLVED',
      targetType: 'Participant',
      targetId: participantHandle,
    });
  }

  public searchActive(
    institutionId: string,
    normalizedQuery: string,
    rawQuery: string,
    take: number,
  ): Promise<ParticipantRecord[]> {
    return this.prisma.msParticipant.findMany({
      where: {
        institutionId,
        status: 'ACTIVE',
        ...(normalizedQuery
          ? {
              OR: [
                { normalizedName: { contains: normalizedQuery } },
                { participantReference: { contains: rawQuery, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: [{ normalizedName: 'asc' }, { participantId: 'asc' }],
      take,
    });
  }

  public createWithAudit(
    context: AuditContext & { readonly institutionId: string },
    input: {
      readonly displayName: string;
      readonly normalizedName: string;
      readonly participantReference: string;
      readonly dateOfBirth?: Date | null;
      readonly gender?: 'MALE' | 'FEMALE' | null;
    },
  ): Promise<ParticipantRecord> {
    return this.prisma.$transaction(async (transaction) => {
      const participant = await transaction.msParticipant.create({
        data: {
          institutionId: context.institutionId,
          participantId: publicHandle(),
          participantReference: input.participantReference,
          displayName: input.displayName,
          normalizedName: input.normalizedName,
          dateOfBirth: input.dateOfBirth ?? null,
          gender: input.gender ?? null,
        },
      });
      await writeAudit(transaction, context, {
        action: 'PARTICIPANT_CREATED',
        targetType: 'Participant',
        targetId: participant.participantId,
      });
      return participant;
    });
  }

  public updateWithAudit(
    context: AuditContext & { readonly institutionId: string },
    participantHandle: string,
    changes: ParticipantUpdateData,
    changedFields: readonly string[],
  ): Promise<ParticipantRecord | null> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.msParticipant.findFirst({
        where: { institutionId: context.institutionId, participantId: participantHandle },
      });
      if (!current) return null;

      const participant = await tx.msParticipant.update({
        where: { id: current.id },
        data: {
            ...(changes.displayName === undefined ? {} : { displayName: changes.displayName }),
            ...(changes.image === undefined ? {} : { image: changes.image }),
            ...(changes.dateOfBirth === undefined ? {} : { dateOfBirth: changes.dateOfBirth }),
            ...(changes.gender === undefined ? {} : { gender: changes.gender }),
            ...(changes.normalizedName === undefined
            ? {}
            : { normalizedName: changes.normalizedName }),
          ...(changes.participantReference === undefined
            ? {}
            : { participantReference: changes.participantReference }),
          ...(changes.status === undefined ? {} : { status: changes.status }),
        },
      });
      await writeAudit(tx, context, {
        action: 'PARTICIPANT_UPDATED',
        targetType: 'Participant',
        targetId: current.id,
        metadata: { changedFields },
      });
      return participant;
    });
  }

  public countSessions(
    institutionId: string,
    participantId: string,
    filters: ParticipantHistoryFilters,
  ): Promise<number> {
    return this.prisma.trGameSession.count({
      where: {
        institutionId,
        participantId,
        ...(filters.mode ? { mode: filters.mode } : {}),
        ...(filters.ruleVersion ? { gameRuleVersionSnapshot: filters.ruleVersion } : {}),
      },
    });
  }

  public listSessions(
    institutionId: string,
    participantId: string,
    filters: ParticipantHistoryFilters,
    take: number,
  ): Promise<ParticipantSessionRecord[]> {
    const where: Prisma.TrGameSessionWhereInput = {
      institutionId,
      participantId,
      ...(filters.mode ? { mode: filters.mode } : {}),
      ...(filters.ruleVersion ? { gameRuleVersionSnapshot: filters.ruleVersion } : {}),
      ...(filters.before
        ? {
            OR: [
              { createdAt: { lt: filters.before.at } },
              { createdAt: filters.before.at, id: { lt: filters.before.id } },
            ],
          }
        : {}),
    };
    return this.prisma.trGameSession.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take,
      select: {
        id: true,
        mode: true,
        status: true,
        startedAt: true,
        completedAt: true,
        createdAt: true,
        result: { select: { score: true, metrics: true, gameRuleVersion: true } },
      },
    });
  }

  public listLeaderboard(
    institutionId: string,
    participantId: string,
    mode: GameMode,
    ruleVersion: string,
  ): Promise<ParticipantLeaderboardRecord[]> {
    return this.prisma.trGameResult.findMany({
      where: {
        institutionId,
        participantId,
        mode,
        gameRuleVersion: ruleVersion,
        session: { status: 'SAVED', institutionId },
      },
      orderBy: [{ score: 'desc' }, { completedAt: 'asc' }, { sessionId: 'asc' }],
      take: 10,
      select: { sessionId: true, completedAt: true, score: true, metrics: true },
    });
  }

  public async ensureActiveParticipant(
    institutionId: string,
    input: {
      readonly displayName: string;
      readonly normalizedName: string;
      readonly participantReference: string;
    },
  ): Promise<EnsuredParticipantRecord> {
    const existing = await this.findIdentity(institutionId, input.participantReference);
    if (existing) return this.refreshIdentity(existing, input);

    try {
      return await this.prisma.msParticipant.create({
        data: {
          institutionId,
          participantId: publicHandle(),
          participantReference: input.participantReference,
          displayName: input.displayName,
          normalizedName: input.normalizedName,
        },
        select: { id: true, participantId: true, status: true },
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const winner = await this.findIdentity(institutionId, input.participantReference);
      if (!winner) throw error;
      return this.refreshIdentity(winner, input);
    }
  }

  private findIdentity(
    institutionId: string,
    participantReference: string,
  ): Promise<EnsuredParticipantRecord | null> {
    return this.prisma.msParticipant.findFirst({
      where: { institutionId, participantReference },
      select: { id: true, participantId: true, status: true },
    });
  }

  private async refreshIdentity(
    participant: EnsuredParticipantRecord,
    input: { readonly displayName: string; readonly normalizedName: string },
  ): Promise<EnsuredParticipantRecord> {
    if (participant.status === 'INACTIVE') return participant;
    await this.prisma.msParticipant.update({
      where: { id: participant.id },
      data: { displayName: input.displayName, normalizedName: input.normalizedName },
    });
    return participant;
  }
}
