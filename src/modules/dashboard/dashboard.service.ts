import type { GameMode } from '../../schemas/index.js';
import { mapDeviceSnapshot } from '../device/device.service.js';
import type { DashboardRepository } from './dashboard.repository.js';
import {
  DashboardActivityDtoSchema,
  DashboardLeaderboardDtoSchema,
  DashboardProgressDtoSchema,
  DashboardSummaryDtoSchema,
  type DashboardActivityDto,
  type DashboardLeaderboardDto,
  type DashboardProgressDto,
  type DashboardSummaryDto,
} from './dashboard.validation.js';

export class DashboardService {
  constructor(private readonly repository: DashboardRepository) {}

  async activity(institutionId: string): Promise<DashboardActivityDto> {
    const activity = await this.repository.activity(institutionId);
    return DashboardActivityDtoSchema.parse({
      ...activity,
      latestSavedAt: activity.latestSavedAt?.toISOString() ?? null,
      modes: activity.modes.map((mode) => ({
        ...mode,
        latestSavedAt: mode.latestSavedAt?.toISOString() ?? null,
      })),
    });
  }

  async leaderboard(institutionId: string, mode: GameMode): Promise<DashboardLeaderboardDto> {
    const entries = await this.repository.leaderboard(institutionId, mode);
    return DashboardLeaderboardDtoSchema.parse({
      mode,
      entries: entries.map((entry, index) => ({
        rank: index + 1,
        participantId: entry.participant.participantId,
        displayName: entry.participant.displayName,
        score: entry.score,
        sessionsTotal: entry.sessionsTotal,
        completedAt: entry.completedAt.toISOString(),
      })),
    });
  }

  async progress(institutionId: string): Promise<DashboardProgressDto> {
    const progress = await this.repository.progress(institutionId);
    return DashboardProgressDtoSchema.parse({
      generatedAt: progress.generatedAt.toISOString(),
      participants: progress.participants.map((participant) => {
        const scoreDelta =
          participant.latest && participant.previousComparableScore !== null
            ? participant.latest.score - participant.previousComparableScore
            : null;
        const progressStatus =
          scoreDelta === null
            ? 'NO_BASELINE'
            : scoreDelta > 0
              ? 'IMPROVED'
              : scoreDelta < 0
                ? 'LOWER'
                : 'MAINTAINED';
        const achievementStatus =
          participant.savedSessionsTotal === 0
            ? 'NOT_STARTED'
            : participant.savedSessionsTotal === 1
              ? 'FIRST_SESSION'
              : scoreDelta !== null && scoreDelta > 0
                ? 'IMPROVED'
                : participant.activeWeeksLast4 >= 3
                  ? 'CONSISTENT'
                  : 'CONTINUING';
        return {
          participantId: participant.participantId,
          displayName: participant.displayName,
          image: participant.image,
          dateOfBirth: participant.dateOfBirth?.toISOString().slice(0, 10) ?? null,
          gender: participant.gender,
          savedSessionsTotal: participant.savedSessionsTotal,
          sessionsLast7Days: participant.sessionsLast7Days,
          activeWeeksLast4: participant.activeWeeksLast4,
          lastSession: participant.latest
            ? {
                mode: participant.latest.mode,
                completedAt: participant.latest.completedAt.toISOString(),
              }
            : null,
          progress:
            progressStatus === 'NO_BASELINE'
              ? { status: progressStatus, scoreDelta: null }
              : { status: progressStatus, scoreDelta },
          achievementStatus,
        };
      }),
    });
  }

  async summary(institutionId: string): Promise<DashboardSummaryDto> {
    const snapshots = await this.repository.listInstitutionDeviceSnapshots(institutionId);
    const devices = snapshots.map(mapDeviceSnapshot);
    const readyDevices = devices.filter((device) => device.readinessCode === 'READY').length;
    const onlineDevices = devices.filter((device) => device.connectionStatus === 'ONLINE').length;
    const totalActiveDevices = devices.filter(
      (device) => device.inventoryStatus === 'ACTIVE',
    ).length;
    const readinessMessage =
      readyDevices > 0
        ? `${readyDevices} perangkat siap digunakan.`
        : totalActiveDevices === 0
          ? 'Belum ada perangkat aktif untuk institusi ini.'
          : 'Belum ada perangkat yang siap digunakan.';
    return DashboardSummaryDtoSchema.parse({
      readyDevices,
      onlineDevices,
      totalActiveDevices,
      readinessMessage,
    });
  }
}
