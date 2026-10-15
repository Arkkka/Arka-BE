import type { GameMode, PrismaClient } from '../../generated/prisma/client.js';
import type { DeviceRepository, DeviceSnapshot } from '../device/device.repository.js';

export interface DashboardProgressRecord {
  readonly generatedAt: Date;
  readonly participants: readonly {
    readonly participantId: string;
    readonly displayName: string;
    readonly image: string | null;
    readonly dateOfBirth: Date | null;
    readonly gender: 'MALE' | 'FEMALE' | null;
    readonly savedSessionsTotal: number;
    readonly sessionsLast7Days: number;
    readonly activeWeeksLast4: number;
    readonly latest: {
      readonly mode: GameMode;
      readonly completedAt: Date;
      readonly score: number;
      readonly gameRuleVersion: string;
      readonly sessionId: string;
    } | null;
    readonly previousComparableScore: number | null;
  }[];
}

export interface DashboardActivityRecord {
  readonly activeParticipants: number;
  readonly savedSessionsTotal: number;
  readonly savedSessionsLast7Days: number;
  readonly latestSavedAt: Date | null;
  readonly dailySavedSessions: readonly {
    readonly date: string;
    readonly savedSessions: number;
  }[];
  readonly modes: readonly {
    readonly mode: GameMode;
    readonly savedSessions: number;
    readonly sessionsLast7Days: number;
    readonly latestSavedAt: Date | null;
    readonly latestRuleVersion: string | null;
  }[];
}

const MODES: readonly GameMode[] = ['MOTOR_GRIP', 'GO_NO_GO', 'SEQUENCE_MEMORY'];

export class DashboardRepository {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly devices: DeviceRepository,
  ) {}

  listInstitutionDeviceSnapshots(institutionId: string): Promise<DeviceSnapshot[]> {
    return this.devices.listInstitutionDevices(institutionId);
  }

  async leaderboard(institutionId: string, mode: GameMode) {
    const grouped = await this.prisma.trGameResult.groupBy({
      by: ['participantId'],
      where: {
        institutionId,
        mode,
        participantId: { not: null },
        session: { institutionId, status: 'SAVED' },
      },
      _avg: { score: true },
      _count: { _all: true },
      _max: { completedAt: true },
    });
    const ranked = grouped
      .filter((entry) => entry.participantId && entry._avg.score !== null && entry._max.completedAt)
      .sort((left, right) =>
        (right._avg.score ?? 0) - (left._avg.score ?? 0) ||
        (left._max.completedAt?.getTime() ?? 0) - (right._max.completedAt?.getTime() ?? 0) ||
        (left.participantId ?? '').localeCompare(right.participantId ?? ''),
      )
      .slice(0, 10);
    const participants = await this.prisma.msParticipant.findMany({
      where: {
        institutionId,
        id: { in: ranked.flatMap((entry) => entry.participantId ? [entry.participantId] : []) },
      },
      select: { id: true, participantId: true, displayName: true },
    });
    const participantsById = new Map(participants.map((participant) => [participant.id, participant]));
    return ranked.flatMap((entry) => {
      const participant = entry.participantId ? participantsById.get(entry.participantId) : undefined;
      if (!participant || entry._avg.score === null || !entry._max.completedAt) return [];
      return [{
        participant,
        score: Math.round(entry._avg.score),
        sessionsTotal: entry._count._all,
        completedAt: entry._max.completedAt,
      }];
    });
  }

  async progress(institutionId: string, now = new Date()): Promise<DashboardProgressRecord> {
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const twentyEightDaysAgo = new Date(now.getTime() - 28 * 24 * 60 * 60 * 1000);
    const participants = await this.prisma.msParticipant.findMany({
      where: { institutionId, status: 'ACTIVE' },
      orderBy: [{ normalizedName: 'asc' }, { participantId: 'asc' }],
      select: { id: true, participantId: true, displayName: true, image: true, dateOfBirth: true, gender: true },
    });

    return {
      generatedAt: now,
      participants: await Promise.all(
        participants.map(async (participant) => {
          const savedWhere = {
            institutionId,
            participantId: participant.id,
            session: { institutionId, status: 'SAVED' as const },
          };
          const [savedSessionsTotal, sessionsLast7Days, recentResults, latest] = await Promise.all([
            this.prisma.trGameResult.count({ where: savedWhere }),
            this.prisma.trGameResult.count({
              where: { ...savedWhere, completedAt: { gte: sevenDaysAgo, lte: now } },
            }),
            this.prisma.trGameResult.findMany({
              where: { ...savedWhere, completedAt: { gte: twentyEightDaysAgo, lte: now } },
              select: { completedAt: true },
            }),
            this.prisma.trGameResult.findFirst({
              where: savedWhere,
              orderBy: [{ completedAt: 'desc' }, { sessionId: 'desc' }],
              select: {
                mode: true,
                completedAt: true,
                score: true,
                gameRuleVersion: true,
                sessionId: true,
              },
            }),
          ]);
          const activeWeeks = new Set(
            recentResults.map((result) =>
              Math.min(3, Math.floor((now.getTime() - result.completedAt.getTime()) / (7 * 24 * 60 * 60 * 1000))),
            ),
          );
          const previous = latest
            ? await this.prisma.trGameResult.findFirst({
                where: {
                  ...savedWhere,
                  mode: latest.mode,
                  gameRuleVersion: latest.gameRuleVersion,
                  OR: [
                    { completedAt: { lt: latest.completedAt } },
                    { completedAt: latest.completedAt, sessionId: { lt: latest.sessionId } },
                  ],
                },
                orderBy: [{ completedAt: 'desc' }, { sessionId: 'desc' }],
                select: { score: true },
              })
            : null;
          return {
            participantId: participant.participantId,
            displayName: participant.displayName,
            image: participant.image,
            dateOfBirth: participant.dateOfBirth,
            gender: participant.gender,
            savedSessionsTotal,
            sessionsLast7Days,
            activeWeeksLast4: activeWeeks.size,
            latest,
            previousComparableScore: previous?.score ?? null,
          };
        }),
      ),
    };
  }

  async activity(institutionId: string, now = new Date()): Promise<DashboardActivityRecord> {
    const todayUtc = new Date(now);
    todayUtc.setUTCHours(0, 0, 0, 0);
    const seriesStart = new Date(todayUtc.getTime() - 6 * 24 * 60 * 60 * 1000);
    const savedWhere = { institutionId, session: { status: 'SAVED' as const, institutionId } };
    const [
      activeParticipants,
      savedSessionsTotal,
      recentResults,
      latest,
      totalsByMode,
      recentByMode,
      latestByMode,
    ] = await Promise.all([
      this.prisma.msParticipant.count({ where: { institutionId, status: 'ACTIVE' } }),
      this.prisma.trGameResult.count({ where: savedWhere }),
      this.prisma.trGameResult.findMany({
        where: { ...savedWhere, completedAt: { gte: seriesStart, lte: now } },
        select: { completedAt: true },
      }),
      this.prisma.trGameResult.findFirst({
        where: savedWhere,
        orderBy: { completedAt: 'desc' },
        select: { completedAt: true },
      }),
      this.prisma.trGameResult.groupBy({
        by: ['mode'],
        where: savedWhere,
        _count: { _all: true },
        _max: { completedAt: true },
      }),
      this.prisma.trGameResult.groupBy({
        by: ['mode'],
        where: { ...savedWhere, completedAt: { gte: seriesStart, lte: now } },
        _count: { _all: true },
      }),
      Promise.all(
        MODES.map((mode) =>
          this.prisma.trGameResult.findFirst({
            where: { ...savedWhere, mode },
            orderBy: { completedAt: 'desc' },
            select: { mode: true, completedAt: true, gameRuleVersion: true },
          }),
        ),
      ),
    ]);

    const sessionsByDate = new Map<string, number>();
    for (const result of recentResults) {
      const date = result.completedAt.toISOString().slice(0, 10);
      sessionsByDate.set(date, (sessionsByDate.get(date) ?? 0) + 1);
    }
    const dailySavedSessions = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(seriesStart.getTime() + index * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
      return { date, savedSessions: sessionsByDate.get(date) ?? 0 };
    });

    return {
      activeParticipants,
      savedSessionsTotal,
      savedSessionsLast7Days: recentResults.length,
      latestSavedAt: latest?.completedAt ?? null,
      dailySavedSessions,
      modes: MODES.map((mode) => {
        const total = totalsByMode.find((entry) => entry.mode === mode);
        const recent = recentByMode.find((entry) => entry.mode === mode);
        const latestMode = latestByMode.find((entry) => entry?.mode === mode);
        return {
          mode,
          savedSessions: total?._count._all ?? 0,
          sessionsLast7Days: recent?._count._all ?? 0,
          latestSavedAt: total?._max.completedAt ?? null,
          latestRuleVersion: latestMode?.gameRuleVersion ?? null,
        };
      }),
    };
  }
}
