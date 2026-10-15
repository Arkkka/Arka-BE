import type { GoNoGoStimulus } from './go-no-go.js';

export interface FsrEdgeState {
  readonly pressed: boolean;
  readonly armed: boolean;
}

export interface FsrEdgeTransition {
  readonly state: FsrEdgeState;
  readonly edge: 'PRESS' | 'RELEASE' | null;
  readonly instruction: 'RELEASE' | null;
}

export function classifyFsrEdge(
  state: FsrEdgeState,
  raw: number,
  pressThreshold: number,
  releaseThreshold: number,
): FsrEdgeTransition {
  if (!Number.isInteger(raw) || raw < 0 || raw > 4095 || releaseThreshold >= pressThreshold) {
    throw new RangeError('Invalid FSR hysteresis input');
  }
  if (state.pressed) {
    if (raw < releaseThreshold)
      return { state: { pressed: false, armed: true }, edge: 'RELEASE', instruction: null };
    return { state, edge: null, instruction: 'RELEASE' };
  }
  if (!state.armed && raw < releaseThreshold) {
    return { state: { pressed: false, armed: true }, edge: null, instruction: null };
  }
  if (state.armed && raw >= pressThreshold) {
    return { state: { pressed: true, armed: false }, edge: 'PRESS', instruction: 'RELEASE' };
  }
  return { state, edge: null, instruction: null };
}

export interface PracticeTrial {
  readonly index: number;
  readonly stimulus: GoNoGoStimulus;
  readonly isTarget: boolean;
}
