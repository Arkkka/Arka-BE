import type { EngineCompletion } from './types.js';
import { assertMonotonic, clamp, mean } from './types.js';

export const GO_NO_GO_STIMULI = ['WAYANG', 'BATIK', 'CANDI', 'MONAS', 'ANGKLUNG'] as const;
export type GoNoGoStimulus = (typeof GO_NO_GO_STIMULI)[number];
export type GoNoGoOutcome = 'HIT' | 'MISS' | 'FALSE_POSITIVE' | 'CORRECT_REJECTION';

export interface GoNoGoLevelConfig {
  level: 1 | 2;
  stimulusDurationMs: number;
}

export interface GoNoGoConfig {
  targetPreviewDurationMs: number;
  transitionDurationMs: number;
  questionsPerLevel: number;
  maxTargetAppearances: number;
  distractorsBeforeTarget: {
    min: number;
    max: number;
  };
  levels: readonly [GoNoGoLevelConfig, GoNoGoLevelConfig];
}

export interface GoNoGoCandidatePlan {
  readonly candidateIndex: number;
  readonly stimulus: GoNoGoStimulus;
  readonly assetIndex: number;
  readonly isTarget: boolean;
  readonly targetAppearance: 1 | 2 | null;
}

export interface GoNoGoTrialPlan {
  readonly index: number;
  readonly trialIndex: number;
  readonly questionNumber: number;
  readonly level: 1 | 2;
  readonly levelTrialNumber: number;
  readonly levelQuestionNumber: number;
  readonly stimulusDurationMs: number;
  readonly stimulus: GoNoGoStimulus;
  readonly assetIndex: number;
  readonly isTarget: true;
  readonly targetStimulus: GoNoGoStimulus;
  readonly targetAssetIndex: number;
  readonly candidates: readonly GoNoGoCandidatePlan[];
}

export interface GoNoGoTrialResult extends Omit<GoNoGoTrialPlan, 'candidates'> {
  readonly outcome: GoNoGoOutcome;
  readonly reactionMs: number | null;
  readonly duplicatePresses: number;
  readonly stimulusStartedAtMs: number;
  readonly responseClosedAtMs: number;
  readonly questionStartedAtMs: number;
  readonly pressedCandidateStimulus: GoNoGoStimulus | null;
  readonly pressedCandidateAssetIndex: number | null;
  readonly pressedCandidateIndex: number | null;
  readonly targetAppearance: 1 | 2 | null;
}

export interface GoNoGoLevelMetrics {
  level: number;
  stimulusDurationMs: number;
  totalTrials: number;
  hits: number;
  misses: number;
  falsePositives: number;
  correctRejections: number;
  accuracyPercent: number;
  meanHitReactionMs: number | null;
}

export interface GoNoGoMetrics {
  mode: 'GO_NO_GO';
  totalTrials: number;
  targetTrials: number;
  nonTargetTrials: number;
  hits: number;
  misses: number;
  falsePositives: number;
  correctRejections: number;
  accuracyPercent: number;
  meanHitReactionMs: number | null;
  levelBreakdown: GoNoGoLevelMetrics[];
}

export interface GoNoGoState {
  readonly mode: 'GO_NO_GO';
  readonly lifecycle: 'PLAYING' | 'PAUSED' | 'COMPLETED';
  readonly config: GoNoGoConfig;
  readonly plan: readonly GoNoGoTrialPlan[];
  readonly currentTrialIndex: number;
  readonly currentCandidateIndex: number;
  readonly questionStartedAtMs: number;
  readonly questionTransitionEndsAtMs: number;
  readonly targetPreviewEndsAtMs: number;
  readonly candidateStartedAtMs: number;
  readonly responseClosesAtMs: number;
  readonly outOfWindowPresses: number;
  readonly activeElapsedMs: number;
  readonly lastNowMs: number;
  readonly pauseQuestionTransitionEndsInMs: number | null;
  readonly pauseCandidateStartsInMs: number | null;
  readonly pauseRemainingMs: number | null;
  readonly pauseTargetPreviewEndsInMs: number | null;
  readonly trials: readonly GoNoGoTrialResult[];
  readonly completion: EngineCompletion<GoNoGoMetrics, GoNoGoTrialResult> | null;
}

export interface GoNoGoTransition {
  readonly state: GoNoGoState;
  readonly acceptedPress: boolean;
  readonly visual: {
    mode: 'GO_NO_GO';
    trialNumber: number;
    questionNumber: number;
    totalQuestions: number;
    level: 1 | 2;
    levelTrialNumber: number;
    levelQuestionNumber: number;
    levelTrialCount: number;
    totalLevels: 2;
    targetStimulus: GoNoGoStimulus;
    targetAssetIndex: number;
    stimulus: GoNoGoStimulus | null;
    assetIndex: number | null;
    candidateIndex: number | null;
    candidateNumber: number | null;
    targetAppearance: 1 | 2 | null;
    phase: 'TARGET_PREVIEW' | 'TRANSITION' | 'STIMULUS';
    activeElapsedMs: number;
    remainingMs: number;
    feedback: null;
    correctTrials: number;
  };
  readonly completed: EngineCompletion<GoNoGoMetrics, GoNoGoTrialResult> | null;
}

interface ExactAsset {
  readonly stimulus: GoNoGoStimulus;
  readonly assetIndex: number;
}

const LEGACY_MAX_SESSION_MS = 180_000;
const NEXT_QUESTION_TRANSITION_MS = 2_600;
const ALL_ASSETS: readonly ExactAsset[] = GO_NO_GO_STIMULI.flatMap((stimulus) =>
  Array.from({ length: 4 }, (_, assetIndex) => ({ stimulus, assetIndex })),
);

function nextRandom(state: number): readonly [number, number] {
  let value = state >>> 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  const next = value >>> 0 || 0x9e3779b9;
  return [next / 0x1_0000_0000, next];
}

function validateConfig(config: GoNoGoConfig): void {
  const [level1, level2] = config.levels;
  const valid =
    config.targetPreviewDurationMs === 3_000 &&
    config.transitionDurationMs === 500 &&
    config.questionsPerLevel === 5 &&
    config.maxTargetAppearances === 2 &&
    config.distractorsBeforeTarget.min === 1 &&
    config.distractorsBeforeTarget.max === 3 &&
    level1.level === 1 &&
    level1.stimulusDurationMs === 3_000 &&
    level2.level === 2 &&
    level2.stimulusDurationMs === 2_000;
  if (!valid) throw new RangeError('Invalid Go/No-Go rule configuration');
}

function sameAsset(left: ExactAsset | undefined, right: ExactAsset): boolean {
  return left?.stimulus === right.stimulus && left.assetIndex === right.assetIndex;
}

function matchesTarget(candidate: ExactAsset, target: ExactAsset): boolean {
  // Exact-image mode for future use:
  // return sameAsset(candidate, target);
  return candidate.stimulus === target.stimulus;
}

function randomAsset(
  cursor: number,
  excluded: readonly ExactAsset[],
  excludedStimulus?: GoNoGoStimulus,
): readonly [ExactAsset, number] {
  const candidates = ALL_ASSETS.filter(
    (candidate) =>
      candidate.stimulus !== excludedStimulus &&
      !excluded.some((asset) => sameAsset(asset, candidate)),
  );
  const [random, next] = nextRandom(cursor);
  return [candidates[Math.floor(random * candidates.length)]!, next];
}

function randomTargetVariant(cursor: number, target: ExactAsset): readonly [ExactAsset, number] {
  const [random, next] = nextRandom(cursor);
  return [{ stimulus: target.stimulus, assetIndex: Math.floor(random * 4) }, next];
}

export function generateGoNoGoPlan(seed: number, config: GoNoGoConfig): readonly GoNoGoTrialPlan[] {
  validateConfig(config);
  let cursor = seed >>> 0 || 0x9e3779b9;
  let previousCandidate: ExactAsset | undefined;
  const plan: GoNoGoTrialPlan[] = [];
  for (const level of config.levels) {
    for (let levelQuestionNumber = 1; levelQuestionNumber <= config.questionsPerLevel; levelQuestionNumber += 1) {
      const [target, next] = randomAsset(cursor, []);
      cursor = next;
      const candidates: GoNoGoCandidatePlan[] = [];
      for (let appearance = 1; appearance <= config.maxTargetAppearances; appearance += 1) {
        const [countRandom, countNext] = nextRandom(cursor);
        cursor = countNext;
        const distractorCount =
          config.distractorsBeforeTarget.min +
          Math.floor(
            countRandom *
              (config.distractorsBeforeTarget.max - config.distractorsBeforeTarget.min + 1),
          );
        for (let index = 0; index < distractorCount; index += 1) {
          const [distractor, distractorNext] = randomAsset(
            cursor,
            previousCandidate ? [previousCandidate] : [],
            target.stimulus,
          );
          cursor = distractorNext;
          candidates.push({
            candidateIndex: candidates.length,
            stimulus: distractor.stimulus,
            assetIndex: distractor.assetIndex,
            isTarget: false,
            targetAppearance: null,
          });
          previousCandidate = distractor;
        }
        const [targetVariant, targetNext] = randomTargetVariant(cursor, target);
        cursor = targetNext;
        candidates.push({
          candidateIndex: candidates.length,
          stimulus: targetVariant.stimulus,
          assetIndex: targetVariant.assetIndex,
          isTarget: matchesTarget(targetVariant, target),
          targetAppearance: appearance as 1 | 2,
        });
        previousCandidate = targetVariant;
      }
      const index = plan.length;
      plan.push({
        index,
        trialIndex: index,
        questionNumber: index + 1,
        level: level.level,
        levelTrialNumber: levelQuestionNumber,
        levelQuestionNumber,
        stimulusDurationMs: level.stimulusDurationMs,
        stimulus: target.stimulus,
        assetIndex: target.assetIndex,
        isTarget: true,
        targetStimulus: target.stimulus,
        targetAssetIndex: target.assetIndex,
        candidates,
      });
    }
  }
  return plan;
}

function questionTiming(config: GoNoGoConfig, question: GoNoGoTrialPlan, startsAtMs: number, withTransition = false) {
  const questionTransitionEndsAtMs = startsAtMs + (withTransition ? NEXT_QUESTION_TRANSITION_MS : 0);
  const targetPreviewEndsAtMs = questionTransitionEndsAtMs + config.targetPreviewDurationMs;
  const candidateStartedAtMs = targetPreviewEndsAtMs + config.transitionDurationMs;
  return {
    questionStartedAtMs: startsAtMs,
    questionTransitionEndsAtMs,
    targetPreviewEndsAtMs,
    candidateStartedAtMs,
    responseClosesAtMs: candidateStartedAtMs + question.stimulusDurationMs,
  };
}

export function createGoNoGo(config: GoNoGoConfig, seed: number, nowMs: number): GoNoGoState {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) throw new RangeError('Invalid monotonic timestamp');
  const plan = generateGoNoGoPlan(seed, config);
  return {
    mode: 'GO_NO_GO',
    lifecycle: 'PLAYING',
    config: {
      ...config,
      distractorsBeforeTarget: { ...config.distractorsBeforeTarget },
      levels: config.levels.map((level) => ({ ...level })) as [GoNoGoLevelConfig, GoNoGoLevelConfig],
    },
    plan,
    currentTrialIndex: 0,
    currentCandidateIndex: 0,
    ...questionTiming(config, plan[0]!, nowMs),
    outOfWindowPresses: 0,
    activeElapsedMs: 0,
    lastNowMs: nowMs,
    pauseQuestionTransitionEndsInMs: null,
    pauseCandidateStartsInMs: null,
    pauseRemainingMs: null,
    pauseTargetPreviewEndsInMs: null,
    trials: [],
    completion: null,
  };
}

function metricsForTrials(trials: readonly GoNoGoTrialResult[]): Omit<GoNoGoLevelMetrics, 'level' | 'stimulusDurationMs'> {
  const hits = trials.filter((trial) => trial.outcome === 'HIT').length;
  const misses = trials.filter((trial) => trial.outcome === 'MISS').length;
  const falsePositives = trials.filter((trial) => trial.outcome === 'FALSE_POSITIVE').length;
  return {
    totalTrials: trials.length,
    hits,
    misses,
    falsePositives,
    correctRejections: 0,
    accuracyPercent: trials.length === 0 ? 0 : (hits / trials.length) * 100,
    meanHitReactionMs: mean(
      trials.filter((trial) => trial.outcome === 'HIT').map((trial) => trial.reactionMs as number),
    ),
  };
}

function completionFor(
  trials: readonly GoNoGoTrialResult[],
  config: GoNoGoConfig,
): EngineCompletion<GoNoGoMetrics, GoNoGoTrialResult> {
  const aggregate = metricsForTrials(trials);
  const metrics: GoNoGoMetrics = {
    mode: 'GO_NO_GO',
    ...aggregate,
    targetTrials: config.questionsPerLevel * config.levels.length,
    nonTargetTrials: 0,
    correctRejections: 0,
    levelBreakdown: config.levels.map((level) => ({
      level: level.level,
      stimulusDurationMs: level.stimulusDurationMs,
      ...metricsForTrials(trials.filter((trial) => trial.level === level.level)),
    })),
  };
  return {
    lifecycle: 'COMPLETED',
    score: clamp(Math.round(metrics.accuracyPercent * 10), 0, 1000),
    metrics,
    trials,
  };
}

function closeQuestion(
  state: GoNoGoState,
  closedAtMs: number,
  pressedCandidate: GoNoGoCandidatePlan | null,
): GoNoGoState {
  const question = state.plan[state.currentTrialIndex];
  if (!question) return state;
  const pressedMatchesTarget = pressedCandidate
    ? matchesTarget(pressedCandidate, {
        stimulus: question.targetStimulus,
        assetIndex: question.targetAssetIndex,
      })
    : false;
  const outcome: GoNoGoOutcome = pressedCandidate
    ? pressedMatchesTarget
      ? 'HIT'
      : 'FALSE_POSITIVE'
    : 'MISS';
  const trial: GoNoGoTrialResult = {
    index: question.index,
    trialIndex: question.trialIndex,
    questionNumber: question.questionNumber,
    level: question.level,
    levelTrialNumber: question.levelTrialNumber,
    levelQuestionNumber: question.levelQuestionNumber,
    stimulusDurationMs: question.stimulusDurationMs,
    stimulus: question.stimulus,
    assetIndex: question.assetIndex,
    isTarget: true,
    targetStimulus: question.targetStimulus,
    targetAssetIndex: question.targetAssetIndex,
    outcome,
    reactionMs:
      outcome === 'HIT' ? clamp(closedAtMs - state.candidateStartedAtMs, 0, question.stimulusDurationMs) : null,
    duplicatePresses: 0,
    stimulusStartedAtMs: state.candidateStartedAtMs,
    responseClosedAtMs: closedAtMs,
    questionStartedAtMs: state.questionStartedAtMs,
    pressedCandidateStimulus: pressedCandidate?.stimulus ?? null,
    pressedCandidateAssetIndex: pressedCandidate?.assetIndex ?? null,
    pressedCandidateIndex: pressedCandidate?.candidateIndex ?? null,
    targetAppearance: pressedCandidate?.targetAppearance ?? null,
  };
  const trials = [...state.trials, trial];
  if (trials.length >= state.plan.length) {
    return {
      ...state,
      lifecycle: 'COMPLETED',
      trials,
      responseClosesAtMs: closedAtMs,
      completion: completionFor(trials, state.config),
    };
  }
  const currentTrialIndex = state.currentTrialIndex + 1;
  return {
    ...state,
    currentTrialIndex,
    currentCandidateIndex: 0,
    ...questionTiming(state.config, state.plan[currentTrialIndex]!, closedAtMs, true),
    trials,
  };
}

function advance(state: GoNoGoState, nowMs: number): GoNoGoState {
  assertMonotonic(nowMs, state.lastNowMs);
  if (state.lifecycle !== 'PLAYING') return { ...state, lastNowMs: nowMs };
  const activeRemainingMs = Math.max(0, LEGACY_MAX_SESSION_MS - state.activeElapsedMs);
  const effectiveNowMs = Math.min(nowMs, state.lastNowMs + activeRemainingMs);
  let next: GoNoGoState = { ...state, lastNowMs: effectiveNowMs };
  while (next.lifecycle === 'PLAYING' && effectiveNowMs >= next.responseClosesAtMs) {
    const question = next.plan[next.currentTrialIndex]!;
    const candidate = question.candidates[next.currentCandidateIndex]!;
    if (candidate.targetAppearance === next.config.maxTargetAppearances) {
      next = closeQuestion(next, next.responseClosesAtMs, null);
    } else {
      const candidateStartedAtMs = next.responseClosesAtMs;
      next = {
        ...next,
        currentCandidateIndex: next.currentCandidateIndex + 1,
        candidateStartedAtMs,
        responseClosesAtMs: candidateStartedAtMs + question.stimulusDurationMs,
      };
    }
  }
  const elapsedUntilMs =
    next.lifecycle === 'COMPLETED' ? next.trials.at(-1)!.responseClosedAtMs : effectiveNowMs;
  const activeElapsedMs = clamp(
    state.activeElapsedMs + Math.max(0, elapsedUntilMs - state.lastNowMs),
    0,
    LEGACY_MAX_SESSION_MS,
  );
  if (next.lifecycle === 'PLAYING' && activeElapsedMs >= LEGACY_MAX_SESSION_MS) {
    const timeoutTrials = [...next.trials];
    for (let index = next.currentTrialIndex; index < next.plan.length; index += 1) {
      const question = next.plan[index]!;
      timeoutTrials.push({
        index: question.index,
        trialIndex: question.trialIndex,
        questionNumber: question.questionNumber,
        level: question.level,
        levelTrialNumber: question.levelTrialNumber,
        levelQuestionNumber: question.levelQuestionNumber,
        stimulusDurationMs: question.stimulusDurationMs,
        stimulus: question.stimulus,
        assetIndex: question.assetIndex,
        isTarget: true,
        targetStimulus: question.targetStimulus,
        targetAssetIndex: question.targetAssetIndex,
        outcome: 'MISS',
        reactionMs: null,
        duplicatePresses: 0,
        stimulusStartedAtMs: next.candidateStartedAtMs,
        responseClosedAtMs: effectiveNowMs,
        questionStartedAtMs: next.questionStartedAtMs,
        pressedCandidateStimulus: null,
        pressedCandidateAssetIndex: null,
        pressedCandidateIndex: null,
        targetAppearance: null,
      });
    }
    return {
      ...next,
      lifecycle: 'COMPLETED',
      activeElapsedMs,
      trials: timeoutTrials,
      completion: completionFor(timeoutTrials, state.config),
    };
  }
  return { ...next, activeElapsedMs };
}

function transition(state: GoNoGoState, acceptedPress: boolean): GoNoGoTransition {
  const question = state.plan[state.currentTrialIndex] ?? state.plan.at(-1)!;
  const candidate = question.candidates[state.currentCandidateIndex] ?? question.candidates.at(-1)!;
  const questionTransitionActive =
    state.lifecycle !== 'COMPLETED' && state.currentTrialIndex > 0 && state.lastNowMs < state.questionTransitionEndsAtMs;
  const previewActive =
    state.lifecycle !== 'COMPLETED' &&
    !questionTransitionActive &&
    (state.lifecycle === 'PAUSED'
      ? (state.pauseTargetPreviewEndsInMs ?? 0) > 0
      : state.lastNowMs < state.targetPreviewEndsAtMs);
  const transitionActive =
    state.lifecycle !== 'COMPLETED' &&
    !previewActive &&
    (state.lifecycle === 'PAUSED'
      ? (state.pauseCandidateStartsInMs ?? 0) > 0
      : state.lastNowMs < state.candidateStartedAtMs);
  const phase = questionTransitionActive || transitionActive ? 'TRANSITION' : previewActive ? 'TARGET_PREVIEW' : 'STIMULUS';
  return {
    state,
    acceptedPress,
    visual: {
      mode: 'GO_NO_GO',
      trialNumber: question.questionNumber,
      questionNumber: question.questionNumber,
      totalQuestions: state.plan.length,
      level: question.level,
      levelTrialNumber: question.levelTrialNumber,
      levelQuestionNumber: question.levelQuestionNumber,
      levelTrialCount: state.config.questionsPerLevel,
      totalLevels: 2,
      targetStimulus: question.targetStimulus,
      targetAssetIndex: question.targetAssetIndex,
      stimulus: phase === 'TARGET_PREVIEW' ? question.targetStimulus : phase === 'STIMULUS' ? candidate.stimulus : null,
      assetIndex: phase === 'TARGET_PREVIEW' ? question.targetAssetIndex : phase === 'STIMULUS' ? candidate.assetIndex : null,
      candidateIndex: phase === 'STIMULUS' || (phase === 'TRANSITION' && !questionTransitionActive) ? candidate.candidateIndex : null,
      candidateNumber: phase === 'STIMULUS' || (phase === 'TRANSITION' && !questionTransitionActive) ? candidate.candidateIndex + 1 : null,
      targetAppearance: phase === 'STIMULUS' ? candidate.targetAppearance : null,
      phase,
      activeElapsedMs: state.activeElapsedMs,
      remainingMs: Math.max(0, LEGACY_MAX_SESSION_MS - state.activeElapsedMs),
      feedback: null,
      correctTrials: state.trials.filter((trial) => trial.outcome === 'HIT').length,
    },
    completed: state.completion,
  };
}

export function pressGoNoGo(state: GoNoGoState, nowMs: number): GoNoGoTransition {
  let next = advance(state, nowMs);
  if (
    next.lifecycle !== 'PLAYING' ||
    nowMs < next.candidateStartedAtMs ||
    nowMs >= next.responseClosesAtMs
  ) {
    if (next.lifecycle === 'PLAYING') next = { ...next, outOfWindowPresses: next.outOfWindowPresses + 1 };
    return transition(next, false);
  }
  const question = next.plan[next.currentTrialIndex]!;
  const candidate = question.candidates[next.currentCandidateIndex]!;
  return transition(closeQuestion(next, nowMs, candidate), true);
}

export function tickGoNoGo(state: GoNoGoState, nowMs: number): GoNoGoTransition {
  return transition(advance(state, nowMs), false);
}

export function pauseGoNoGo(state: GoNoGoState, nowMs: number): GoNoGoTransition {
  const next = advance(state, nowMs);
  if (next.lifecycle !== 'PLAYING') return transition(next, false);
  return transition(
    {
      ...next,
      lifecycle: 'PAUSED',
      pauseQuestionTransitionEndsInMs: next.questionTransitionEndsAtMs - nowMs,
      pauseCandidateStartsInMs: next.candidateStartedAtMs - nowMs,
      pauseRemainingMs: next.responseClosesAtMs - nowMs,
      pauseTargetPreviewEndsInMs: next.targetPreviewEndsAtMs - nowMs,
    },
    false,
  );
}

export function resumeGoNoGo(state: GoNoGoState, nowMs: number): GoNoGoTransition {
  assertMonotonic(nowMs, state.lastNowMs);
  if (
    state.lifecycle !== 'PAUSED' ||
    state.pauseQuestionTransitionEndsInMs === null ||
    state.pauseCandidateStartsInMs === null ||
    state.pauseRemainingMs === null ||
    state.pauseTargetPreviewEndsInMs === null
  ) {
    return transition({ ...state, lastNowMs: nowMs }, false);
  }
  return transition(
    {
      ...state,
      lifecycle: 'PLAYING',
      lastNowMs: nowMs,
      questionTransitionEndsAtMs: nowMs + state.pauseQuestionTransitionEndsInMs,
      targetPreviewEndsAtMs: nowMs + state.pauseTargetPreviewEndsInMs,
      candidateStartedAtMs: nowMs + state.pauseCandidateStartsInMs,
      responseClosesAtMs: nowMs + state.pauseRemainingMs,
      pauseQuestionTransitionEndsInMs: null,
      pauseCandidateStartsInMs: null,
      pauseRemainingMs: null,
      pauseTargetPreviewEndsInMs: null,
    },
    false,
  );
}
