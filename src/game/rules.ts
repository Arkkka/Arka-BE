import { isDeepStrictEqual } from 'node:util';
import { GameMode, Prisma, type PrismaClient } from '../generated/prisma/client.js';

export const GAME_RULE_VERSION = 'mvp-1.4.0';
const MOTOR_GRIP_RULE_VERSION = 'mvp-4.1.0';
const GO_NO_GO_RULE_VERSION = 'mvp-2.0.0';
const SEQUENCE_MEMORY_RULE_VERSION = 'mvp-1.8.0';
const OWNER_PRESENCE_GRACE_MS = 30_000;

export const GAME_RULES = [
  {
    mode: GameMode.MOTOR_GRIP,
    version: MOTOR_GRIP_RULE_VERSION,
    config: {
      calibrationPressMinimumRaw: 20,
      baselineRaw: 0,
      calibratedMaxRaw: 4095,
      fullScaleKilograms: 120,
      fruitVariant: 'ORANGE',
      referenceKilograms: 5,
      targetHoldMs: 30_000,
      sessionDurationMs: 30_000,
      telemetryGapMs: 300,
      ownerPresenceGraceMs: OWNER_PRESENCE_GRACE_MS,
      score: {
        maximum: 1_000,
        averageStrengthWeight: 0.7,
        peakStrengthWeight: 0.3,
        referenceKilograms: 5,
      },
      feedback: { audioIntensity: 'LOW', haptic: 'PULSED_LIGHT', led: 'GREEN' },
    },
  },
  {
    mode: GameMode.GO_NO_GO,
    version: GO_NO_GO_RULE_VERSION,
    config: {
      calibrationPressMinimumRaw: 40,
      pressThresholdRaw: 40,
      releaseThresholdRaw: 15,
      assetCatalogVersion: 2,
      targetPreviewDurationMs: 3_000,
      transitionDurationMs: 500,
      questionsPerLevel: 5,
      maxTargetAppearances: 2,
      distractorsBeforeTarget: { min: 1, max: 3 },
      levels: [
        { level: 1, stimulusDurationMs: 3_000 },
        { level: 2, stimulusDurationMs: 2_000 },
      ],
      ownerPresenceGraceMs: OWNER_PRESENCE_GRACE_MS,
      score: { maximum: 1_000, accuracyPercentMultiplier: 10 },
      feedback: { audioIntensity: 'LOW' },
    },
  },
  {
    mode: GameMode.SEQUENCE_MEMORY,
    version: SEQUENCE_MEMORY_RULE_VERSION,
    config: {
      initialSequenceLength: 1,
      maxSequenceLength: 6,
      exampleItemMs: 2_000,
      exampleGapMs: 350,
      initialDelayMs: 1_200,
      responsePromptMs: 2_500,
      responseTimeoutMs: 10_000,
      maxAttempts: 3,
      feedbackMs: 750,
      ownerPresenceGraceMs: OWNER_PRESENCE_GRACE_MS,
      disallowThreeIdenticalInSequence: true,
      score: {
        maximum: 1_000,
        sequenceLengthMultiplier: 125,
        completedLevelMultiplier: 20,
        wrongAttemptPenalty: 50,
        timedOutAttemptPenalty: 25,
      },
      feedback: { audioIntensity: 'LOW' },
    },
  },
] as const satisfies ReadonlyArray<{
  mode: (typeof GameMode)[keyof typeof GameMode];
  version: string;
  config: Prisma.InputJsonObject;
}>;

async function ensureRules(
  transaction: Prisma.TransactionClient,
  institutionId: string,
): Promise<void> {
  for (const rule of GAME_RULES) {
    const identity = { institutionId, mode: rule.mode, version: rule.version };
    const existing = await transaction.msGameRuleVersion.findUnique({
      where: { institutionId_mode_version: identity },
    });
    if (existing && !isDeepStrictEqual(existing.config, rule.config)) {
      throw new Error(`Immutable game rule version collision for ${institutionId}/${rule.mode}/${rule.version}.`);
    }
    await transaction.msGameRuleVersion.updateMany({
      where: {
        institutionId,
        mode: rule.mode,
        isActive: true,
        version: { not: rule.version },
      },
      data: { isActive: false },
    });
    if (existing) {
      if (!existing.isActive || existing.approvedAt === null) {
        await transaction.msGameRuleVersion.update({
          where: { id: existing.id },
          data: { isActive: true, approvedAt: existing.approvedAt ?? new Date() },
        });
      }
    } else {
      await transaction.msGameRuleVersion.createMany({
        data: [{
          ...identity,
          config: rule.config,
          isActive: true,
          approvedAt: new Date(),
        }],
        skipDuplicates: true,
      });
      const created = await transaction.msGameRuleVersion.findUnique({
        where: { institutionId_mode_version: identity },
      });
      if (!created || !isDeepStrictEqual(created.config, rule.config)) {
        throw new Error(`Immutable game rule version collision for ${institutionId}/${rule.mode}/${rule.version}.`);
      }
      if (!created.isActive || created.approvedAt === null) {
        await transaction.msGameRuleVersion.update({
          where: { id: created.id },
          data: { isActive: true, approvedAt: created.approvedAt ?? new Date() },
        });
      }
    }
  }
}

export async function ensureAllInstitutionGameRules(prisma: PrismaClient): Promise<number> {
  const institutions = await prisma.msInstitution.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true },
  });
  for (const institution of institutions) {
    await prisma.$transaction(
      (transaction) => ensureRules(transaction, institution.id),
      { timeout: 30_000 },
    );
  }
  return institutions.length;
}
