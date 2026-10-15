import type { FruitVariant } from '../schemas/common.js';
import type { EngineCompletion } from './types.js';
import { assertMonotonic, clamp } from './types.js';

export interface MotorGripConfig {
  baselineRaw: number;
  calibratedMaxRaw: number;
  fruitVariant: FruitVariant;
  fullScaleKilograms: number;
  targetKilograms: number;
  targetHoldMs: number;
  sessionDurationMs: number;
  telemetryGapMs: number;
}

export interface MotorGripSample {
  elapsedSecond: number;
  gripPercent: number;
  kilograms: number;
}

export interface MotorGripMetrics {
  mode: 'MOTOR_GRIP';
  fruitVariant: FruitVariant;
  targetKilograms: number;
  peakGripPercent: number;
  peakKilograms: number;
  averageKilograms: number;
  continuousHoldMs: number;
  timeAtOrAboveTargetMs: number;
  targetCompleted: boolean;
  sessionElapsedMs: number;
  gripSamples: MotorGripSample[];
}

export interface MotorGripState {
  readonly mode: 'MOTOR_GRIP';
  readonly lifecycle: 'PLAYING' | 'PAUSED' | 'COMPLETED';
  readonly config: Required<MotorGripConfig>;
  readonly lastNowMs: number;
  readonly activeElapsedMs: number;
  readonly lastGripPercent: number;
  readonly lastKilograms: number;
  readonly peakGripPercent: number;
  readonly peakKilograms: number;
  readonly gripSamples: readonly MotorGripSample[];
  readonly currentHoldMs: number;
  readonly longestHoldMs: number;
  readonly timeAtOrAboveTargetMs: number;
  readonly lastSampleAtMs: number;
  readonly completion: EngineCompletion<MotorGripMetrics> | null;
}

export type MotorGripTransition = {
  readonly state: MotorGripState;
  readonly visual: {
    mode: 'MOTOR_GRIP';
    gripPercent: number;
    kilograms: number;
    holdProgressMs: number;
    activeElapsedMs: number;
    remainingMs: number;
    gripSamples: readonly MotorGripSample[];
    fruitVariant: FruitVariant;
    targetKilograms: number;
    averageKilograms: number;
    timeAtOrAboveTargetMs: number;
    message: string;
  };
  readonly completed: EngineCompletion<MotorGripMetrics> | null;
};

function validateConfig(config: MotorGripConfig): Required<MotorGripConfig> {
  const normalized = { ...config };
  if (
    !Number.isFinite(normalized.baselineRaw) ||
    !Number.isFinite(normalized.calibratedMaxRaw) ||
    normalized.calibratedMaxRaw <= normalized.baselineRaw
  ) {
    throw new RangeError('Calibration maximum must be above baseline');
  }
  if (
    !Number.isFinite(normalized.fullScaleKilograms) ||
    normalized.fullScaleKilograms <= 0 ||
    normalized.fullScaleKilograms > 120 ||
    !Number.isFinite(normalized.targetKilograms) ||
    normalized.targetKilograms <= 0 ||
    normalized.targetKilograms > normalized.fullScaleKilograms ||
    !Number.isSafeInteger(normalized.targetHoldMs) ||
    normalized.targetHoldMs <= 0 ||
    !Number.isSafeInteger(normalized.sessionDurationMs) ||
    normalized.sessionDurationMs <= 0 ||
    !Number.isSafeInteger(normalized.telemetryGapMs) ||
    normalized.telemetryGapMs <= 0
  ) {
    throw new RangeError('Invalid motor grip rule configuration');
  }
  return normalized;
}

export function createMotorGrip(config: MotorGripConfig, nowMs: number): MotorGripState {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0)
    throw new RangeError('Invalid monotonic timestamp');
  return {
    mode: 'MOTOR_GRIP',
    lifecycle: 'PLAYING',
    config: validateConfig(config),
    lastNowMs: nowMs,
    activeElapsedMs: 0,
    lastGripPercent: 0,
    lastKilograms: 0,
    peakGripPercent: 0,
    peakKilograms: 0,
    gripSamples: [],
    currentHoldMs: 0,
    longestHoldMs: 0,
    timeAtOrAboveTargetMs: 0,
    lastSampleAtMs: nowMs,
    completion: null,
  };
}

export function rawToKilograms(
  raw: number,
  config: Pick<MotorGripConfig, 'baselineRaw' | 'calibratedMaxRaw' | 'fullScaleKilograms'>,
): number {
  return (normalizeGrip(raw, config) / 100) * config.fullScaleKilograms;
}

export function normalizeGrip(
  raw: number,
  config: Pick<MotorGripConfig, 'baselineRaw' | 'calibratedMaxRaw'>,
): number {
  if (
    !Number.isInteger(raw) ||
    raw < 0 ||
    raw > 4095 ||
    config.calibratedMaxRaw <= config.baselineRaw
  ) {
    throw new RangeError('Invalid FSR sample or calibration');
  }
  return clamp(
    ((raw - config.baselineRaw) / (config.calibratedMaxRaw - config.baselineRaw)) * 100,
    0,
    100,
  );
}

function averageKilograms(samples: readonly MotorGripSample[]): number {
  return samples.length === 0
    ? 0
    : samples.reduce((total, sample) => total + sample.kilograms, 0) / samples.length;
}

function complete(state: MotorGripState): MotorGripState {
  const continuousHoldMs = Math.min(
    state.config.targetHoldMs,
    Math.max(state.longestHoldMs, state.currentHoldMs),
  );
  const targetCompleted = state.peakKilograms >= state.config.targetKilograms;
  const metrics: MotorGripMetrics = {
    mode: 'MOTOR_GRIP',
    fruitVariant: state.config.fruitVariant,
    targetKilograms: state.config.targetKilograms,
    peakGripPercent: state.peakGripPercent,
    peakKilograms: state.peakKilograms ?? 0,
    averageKilograms: averageKilograms(state.gripSamples),
    continuousHoldMs,
    timeAtOrAboveTargetMs: state.timeAtOrAboveTargetMs,
    targetCompleted,
    sessionElapsedMs: state.activeElapsedMs,
    gripSamples: [...state.gripSamples],
  };
  const referenceKilograms = state.config.targetKilograms;
  const averageStrength = clamp(metrics.averageKilograms / referenceKilograms, 0, 1);
  const peakStrength = clamp(metrics.peakKilograms / referenceKilograms, 0, 1);
  const score = Math.round((averageStrength * 0.7 + peakStrength * 0.3) * 1000);
  return {
    ...state,
    lifecycle: 'COMPLETED',
    completion: { lifecycle: 'COMPLETED', score, metrics, trials: [] },
  };
}

function advance(state: MotorGripState, nowMs: number): MotorGripState {
  assertMonotonic(nowMs, state.lastNowMs);
  if (state.lifecycle !== 'PLAYING' || state.completion) return { ...state, lastNowMs: nowMs };

  const remainingMs = state.config.sessionDurationMs - state.activeElapsedMs;
  const deltaMs = Math.min(nowMs - state.lastNowMs, remainingMs);
  let currentHoldMs = state.currentHoldMs;
  let longestHoldMs = state.longestHoldMs;
  let timeAtOrAboveTargetMs = state.timeAtOrAboveTargetMs;
  if (nowMs - state.lastSampleAtMs > state.config.telemetryGapMs) {
    currentHoldMs = 0;
  } else if (state.lastKilograms >= state.config.targetKilograms) {
    currentHoldMs = Math.min(state.config.targetHoldMs, currentHoldMs + deltaMs);
    longestHoldMs = Math.max(longestHoldMs, currentHoldMs);
    timeAtOrAboveTargetMs += deltaMs;
  }
  const activeElapsedMs = state.activeElapsedMs + deltaMs;
  const previousSecond = Math.floor(state.activeElapsedMs / 1_000);
  const currentSecond = Math.floor(activeElapsedMs / 1_000);
  const stale = nowMs - state.lastSampleAtMs > state.config.telemetryGapMs;
  const gripSamples = [...(state.gripSamples ?? [])];
  for (let elapsedSecond = previousSecond + 1; elapsedSecond <= currentSecond; elapsedSecond += 1) {
    gripSamples.push({
      elapsedSecond,
      gripPercent: stale ? 0 : state.lastGripPercent,
      kilograms: stale ? 0 : (state.lastKilograms ?? 0),
    });
  }
  let next: MotorGripState = {
    ...state,
    lastNowMs: nowMs,
    activeElapsedMs,
    currentHoldMs,
    longestHoldMs,
    timeAtOrAboveTargetMs,
    gripSamples,
  };
  if (next.activeElapsedMs >= state.config.sessionDurationMs) next = complete(next);
  return next;
}

function transition(state: MotorGripState): MotorGripTransition {
  const message = state.completion
    ? state.completion.metrics.targetCompleted
      ? 'Target tercapai'
      : 'Waktu selesai'
    : state.lifecycle === 'PAUSED'
      ? 'Dijeda'
      : state.currentHoldMs > 0
        ? 'Pertahankan genggaman'
        : 'Genggam dengan nyaman';
  return {
    state,
    visual: {
      mode: 'MOTOR_GRIP',
      gripPercent: state.lastGripPercent,
      kilograms: state.lastKilograms ?? 0,
      holdProgressMs: state.currentHoldMs,
      activeElapsedMs: state.activeElapsedMs,
      remainingMs: Math.max(0, state.config.sessionDurationMs - state.activeElapsedMs),
      gripSamples: state.gripSamples ?? [],
      fruitVariant: state.config.fruitVariant,
      targetKilograms: state.config.targetKilograms,
      averageKilograms: averageKilograms(state.gripSamples),
      timeAtOrAboveTargetMs: state.timeAtOrAboveTargetMs,
      message,
    },
    completed: state.completion,
  };
}

export function sampleMotorGrip(
  state: MotorGripState,
  raw: number,
  nowMs: number,
): MotorGripTransition {
  let next = advance(state, nowMs);
  if (next.lifecycle !== 'PLAYING') return transition(next);

  const gripPercent = normalizeGrip(raw, next.config);
  const kilograms = rawToKilograms(raw, next.config);
  const wasAbove = next.lastKilograms >= next.config.targetKilograms;
  const isAbove = kilograms >= next.config.targetKilograms;
  let currentHoldMs = next.currentHoldMs;

  if (wasAbove && !isAbove) {
    currentHoldMs = 0;
  } else if (!wasAbove && isAbove) {
    currentHoldMs = 0;
  }

  next = {
    ...next,
    lastGripPercent: gripPercent,
    lastKilograms: kilograms,
    peakGripPercent: Math.max(next.peakGripPercent, gripPercent),
    peakKilograms: Math.max(next.peakKilograms, kilograms),
    currentHoldMs,
    lastSampleAtMs: nowMs,
  };
  return transition(next);
}

export function tickMotorGrip(state: MotorGripState, nowMs: number): MotorGripTransition {
  return transition(advance(state, nowMs));
}

export function pauseMotorGrip(state: MotorGripState, nowMs: number): MotorGripTransition {
  const next = advance(state, nowMs);
  if (next.lifecycle !== 'PLAYING') return transition(next);
  return transition({ ...next, lifecycle: 'PAUSED', currentHoldMs: 0 });
}

export function resumeMotorGrip(state: MotorGripState, nowMs: number): MotorGripTransition {
  assertMonotonic(nowMs, state.lastNowMs);
  if (state.lifecycle !== 'PAUSED') return transition({ ...state, lastNowMs: nowMs });
  return transition({
    ...state,
    lifecycle: 'PLAYING',
    lastNowMs: nowMs,
    lastGripPercent: 0,
    lastKilograms: 0,
    currentHoldMs: 0,
  });
}
