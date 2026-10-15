import type { DeviceHello } from './protocol.js';

export type DeviceFamily = 'GAME12' | 'MODE3';

export const DEVICE_FAMILIES: readonly DeviceFamily[] = ['GAME12', 'MODE3'];

export function redisPrefixForFamily(family: DeviceFamily): string {
  return family === 'GAME12' ? 'arka:{game12}' : 'arka:{mode3}';
}

export function deviceFamilyForCapabilities(
  capabilities: readonly string[],
): DeviceFamily | null {
  const values = new Set(capabilities);
  const hasFsr = values.has('FSR_10HZ');
  const hasTaredFsr = values.has('FSR_TARED_ON_SETUP_BIND');
  const hasButtons = values.has('BUTTONS_4');
  if (hasFsr && hasTaredFsr && !hasButtons) return 'GAME12';
  if (hasButtons && !hasFsr && !hasTaredFsr) return 'MODE3';
  return null;
}

export function deviceFamilyForHello(hello: DeviceHello): DeviceFamily | null {
  return deviceFamilyForCapabilities(hello.payload.capabilities);
}

export function deviceFamilyForMode(
  mode: 'MOTOR_GRIP' | 'GO_NO_GO' | 'SEQUENCE_MEMORY',
): DeviceFamily {
  return mode === 'SEQUENCE_MEMORY' ? 'MODE3' : 'GAME12';
}
