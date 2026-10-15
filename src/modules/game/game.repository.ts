import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';

export interface PersistedGameSession {
  readonly id: string;
  readonly status: string;
  readonly mode: 'MOTOR_GRIP' | 'GO_NO_GO' | 'SEQUENCE_MEMORY';
  readonly displayNameSnapshot: string;
  readonly participant: { readonly participantId: string } | null;
  readonly startedAt: Date | null;
  readonly completedAt: Date | null;
  readonly terminalReason: string | null;
  readonly gameRuleVersionSnapshot: string;
  readonly result: {
    readonly score: number;
    readonly metrics: Prisma.JsonValue;
    readonly savedAt: Date;
  } | null;
  readonly aiSummary: {
    readonly status: string;
    readonly summaryText: string | null;
    readonly observations: Prisma.JsonValue | null;
  } | null;
}

export class GameRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findParticipantStatus(
    institutionId: string,
    participantReference: string,
  ): Promise<string | null> {
    const participant = await this.prisma.msParticipant.findFirst({
      where: { institutionId, participantReference },
      select: { status: true },
    });
    return participant?.status ?? null;
  }

  async findSession(
    institutionId: string,
    sessionId: string,
  ): Promise<PersistedGameSession | null> {
    return this.prisma.trGameSession.findFirst({
      where: { id: sessionId, institutionId },
      select: {
        id: true,
        status: true,
        mode: true,
        displayNameSnapshot: true,
        participant: { select: { participantId: true } },
        startedAt: true,
        completedAt: true,
        terminalReason: true,
        gameRuleVersionSnapshot: true,
        result: { select: { score: true, metrics: true, savedAt: true } },
        aiSummary: { select: { status: true, summaryText: true, observations: true } },
      },
    });
  }
}
