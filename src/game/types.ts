export type EngineLifecycle = 'PLAYING' | 'PAUSED' | 'COMPLETED';

export interface EngineCompletion<TMetrics, TTrial = never> {
  lifecycle: 'COMPLETED';
  score: number;
  metrics: TMetrics;
  trials: readonly TTrial[];
}

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function assertMonotonic(nowMs: number, previousMs: number): void {
  if (!Number.isSafeInteger(nowMs) || nowMs < previousMs) {
    throw new RangeError('Server monotonic timestamp moved backwards');
  }
}

export function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
