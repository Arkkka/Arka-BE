import { GameMetricsSchema, type GameMetrics, type GameMode } from '../schemas/index.js';
import type { Prisma } from '../generated/prisma/client.js';

interface ResultInput {
  readonly score: number;
  readonly metrics: unknown;
}

function average(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function nullableAverage(values: readonly number[]): number | null {
  return values.length === 0 ? null : average(values);
}

export function buildParticipantAggregate(results: readonly ResultInput[]) {
  const parsed = results.flatMap((result) => {
    const metrics = GameMetricsSchema.safeParse(result.metrics);
    return metrics.success ? [{ score: result.score, metrics: metrics.data }] : [];
  });
  const motor = parsed.filter((item): item is { score: number; metrics: Extract<GameMetrics, { mode: 'MOTOR_GRIP' }> } => item.metrics.mode === 'MOTOR_GRIP');
  const attention = parsed.filter((item): item is { score: number; metrics: Extract<GameMetrics, { mode: 'GO_NO_GO' }> } => item.metrics.mode === 'GO_NO_GO');
  const memory = parsed.filter((item): item is { score: number; metrics: Extract<GameMetrics, { mode: 'SEQUENCE_MEMORY' }> } => item.metrics.mode === 'SEQUENCE_MEMORY');
  const aggregate = {
    sessions: parsed.length,
    motorGrip: {
      sessions: motor.length,
      averageScore: Math.round(average(motor.map((item) => item.score))),
      averageKilograms: average(motor.map((item) => item.metrics.averageKilograms)),
      averagePeakKilograms: average(motor.map((item) => item.metrics.peakKilograms)),
      averageContinuousHoldMs: average(motor.map((item) => item.metrics.continuousHoldMs)),
    },
    goNoGo: {
      sessions: attention.length,
      averageScore: Math.round(average(attention.map((item) => item.score))),
      averageAccuracyPercent: average(attention.map((item) => item.metrics.accuracyPercent)),
      averageReactionMs: nullableAverage(attention.flatMap((item) => item.metrics.meanHitReactionMs === null ? [] : [item.metrics.meanHitReactionMs])),
    },
    sequenceMemory: {
      sessions: memory.length,
      averageScore: Math.round(average(memory.map((item) => item.score))),
      averageMaxSequenceLength: average(memory.map((item) => item.metrics.maxSequenceLength)),
      averageFirstResponseMs: nullableAverage(memory.flatMap((item) => item.metrics.meanFirstResponseMs === null ? [] : [item.metrics.meanFirstResponseMs])),
    },
  };
  const modeAggregates = {
    MOTOR_GRIP: {
      mode: 'MOTOR_GRIP',
      sessions: motor.length,
      averageScore: Math.round(average(motor.map((item) => item.score))),
      averageKilograms: average(motor.map((item) => item.metrics.averageKilograms)),
      averagePeakKilograms: average(motor.map((item) => item.metrics.peakKilograms)),
      averageContinuousHoldMs: average(motor.map((item) => item.metrics.continuousHoldMs)),
    },
    GO_NO_GO: {
      mode: 'GO_NO_GO',
      sessions: attention.length,
      averageScore: Math.round(average(attention.map((item) => item.score))),
      averageAccuracyPercent: average(attention.map((item) => item.metrics.accuracyPercent)),
      averageReactionMs: nullableAverage(attention.flatMap((item) => item.metrics.meanHitReactionMs === null ? [] : [item.metrics.meanHitReactionMs])),
      hits: attention.reduce((sum, item) => sum + item.metrics.hits, 0),
      misses: attention.reduce((sum, item) => sum + item.metrics.misses, 0),
      falsePositives: attention.reduce((sum, item) => sum + item.metrics.falsePositives, 0),
    },
    SEQUENCE_MEMORY: {
      mode: 'SEQUENCE_MEMORY',
      sessions: memory.length,
      averageScore: Math.round(average(memory.map((item) => item.score))),
      averageMaxSequenceLength: average(memory.map((item) => item.metrics.maxSequenceLength)),
      averageFirstResponseMs: nullableAverage(memory.flatMap((item) => item.metrics.meanFirstResponseMs === null ? [] : [item.metrics.meanFirstResponseMs])),
      wrongAttempts: memory.reduce((sum, item) => sum + item.metrics.wrongAttempts, 0),
      timedOutAttempts: memory.reduce((sum, item) => sum + item.metrics.timedOutAttempts, 0),
    },
  } as const;
  return { aggregate, modeAggregates };
}

export async function upsertParticipantSummary(
  tx: Prisma.TransactionClient,
  participantId: string,
  institutionId: string,
  changedMode: GameMode,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${participantId}))`;
  const results = await tx.trGameResult.findMany({
    where: { participantId, institutionId },
    select: { score: true, metrics: true },
  });
  const summary = buildParticipantAggregate(results);
  await tx.trParticipantSummary.upsert({
    where: { participantId },
    create: {
      participantId,
      institutionId,
      savedSessionsTotal: summary.aggregate.sessions,
      aggregateMetrics: summary.aggregate,
      participantSummary: '',
      clinicianSummary: '',
      source: 'PENDING',
      availableAt: new Date(),
    },
    update: {
      savedSessionsTotal: summary.aggregate.sessions,
      aggregateMetrics: summary.aggregate,
      participantSummary: '',
      clinicianSummary: '',
      source: 'PENDING',
      attemptCount: 0,
      leaseToken: null,
      leaseExpiresAt: null,
      availableAt: new Date(),
    },
  });
  for (const metrics of Object.values(summary.modeAggregates)) {
    if (metrics.mode !== changedMode || metrics.sessions === 0) continue;
    await tx.trParticipantModeSummary.upsert({
      where: { participantId_mode: { participantId, mode: metrics.mode } },
      create: {
        participantId,
        institutionId,
        mode: metrics.mode,
        aggregateMetrics: metrics,
        source: 'PENDING',
      },
      update: {
        aggregateMetrics: metrics,
        participantSummary: '',
        clinicianSummary: '',
        source: 'PENDING',
        attemptCount: 0,
        leaseToken: null,
        leaseExpiresAt: null,
        availableAt: new Date(),
      },
    });
  }
}
