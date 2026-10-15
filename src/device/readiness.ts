import type { Redis } from 'ioredis';
import { z } from 'zod';
import { redisPrefixForFamily, type DeviceFamily } from './family.js';

const SUPPORTED_DEVICE_FIRMWARE: Readonly<Record<string, true>> = {
  '0.2.0': true,
  '0.2.1': true,
  '0.2.2': true,
  '0.2.3': true,
  '0.2.4': true,
  '0.2.5': true,
  '0.2.6': true,
  '0.2.7': true,
  '0.2.8': true,
  '0.2.9': true,
};

export const GAME12_DEVICE_ID = 'game12-primary';
export const GAME12_DEVICE_LABEL = 'Arka Genggam';
export const MODE3_DEVICE_ID = 'mode3-primary';
export const MODE3_DEVICE_LABEL = 'Arka Ding Dong Dong';

export function deviceIdForFamily(family: DeviceFamily): string {
  return family === 'GAME12' ? GAME12_DEVICE_ID : MODE3_DEVICE_ID;
}

export function deviceLabelForFamily(family: DeviceFamily): string {
  return family === 'GAME12' ? GAME12_DEVICE_LABEL : MODE3_DEVICE_LABEL;
}

export function deviceReadinessKey(family: DeviceFamily): string {
  return `${redisPrefixForFamily(family)}:readiness`;
}

export function isDeviceFirmwareCompatible(firmwareVersion: string): boolean {
  return SUPPORTED_DEVICE_FIRMWARE[firmwareVersion] === true;
}

export const DeviceConnectionStatusSchema = z.enum([
  'ONLINE',
  'OFFLINE',
  'CONNECTING',
  'NOT_AUTHORIZED',
]);
export const DeviceReadinessCodeSchema = z.enum([
  'READY',
  'OFFLINE',
  'NOT_COMPATIBLE',
  'RESERVED',
  'CLEANUP_PENDING',
  'NOT_READY_BATTERY_UNKNOWN',
  'NOT_READY_LOW_BATTERY',
  'DEVICE_FAULT',
]);

export const DeviceReadinessSchema = z
  .object({
    connectionStatus: DeviceConnectionStatusSchema,
    readinessCode: DeviceReadinessCodeSchema,
    firmwareVersion: z.string().max(80).nullable(),
    capabilities: z.array(z.string().max(40)).max(16),
    batteryPercent: z.number().int().min(0).max(100).nullable(),
    lastSeenAt: z.string().datetime().nullable(),
    connectionId: z.string().uuid().nullable(),
    bootId: z.string().uuid().nullable(),
  })
  .strict()
  .superRefine((readiness, context) => {
    const firmwareCompatible =
      readiness.firmwareVersion !== null && isDeviceFirmwareCompatible(readiness.firmwareVersion);
    if (readiness.connectionStatus === 'ONLINE' && !firmwareCompatible) {
      context.addIssue({
        code: 'custom',
        path: ['connectionStatus'],
        message: 'Online devices require supported firmware',
      });
    }
    if (readiness.readinessCode === 'READY' && !firmwareCompatible) {
      context.addIssue({
        code: 'custom',
        path: ['readinessCode'],
        message: 'Ready devices require supported firmware',
      });
    }
    if (
      readiness.firmwareVersion !== null &&
      !firmwareCompatible &&
      readiness.readinessCode !== 'NOT_COMPATIBLE'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['readinessCode'],
        message: 'Unsupported firmware must be marked not compatible',
      });
    }
  });
export type DeviceReadiness = z.infer<typeof DeviceReadinessSchema>;

export const DEVICE_READINESS_TTL_SECONDS = 15;

export function offlineDeviceReadiness(): DeviceReadiness {
  return {
    connectionStatus: 'OFFLINE',
    readinessCode: 'OFFLINE',
    firmwareVersion: null,
    capabilities: [],
    batteryPercent: null,
    lastSeenAt: null,
    connectionId: null,
    bootId: null,
  };
}

export async function writeDeviceReadiness(
  redis: Redis,
  family: DeviceFamily,
  readiness: DeviceReadiness,
): Promise<void> {
  const value = DeviceReadinessSchema.parse(readiness);
  await redis.set(
    deviceReadinessKey(family),
    JSON.stringify(value),
    'EX',
    DEVICE_READINESS_TTL_SECONDS,
  );
}

export async function readDeviceReadiness(
  redis: Redis,
  family: DeviceFamily,
): Promise<DeviceReadiness> {
  let stored: string | null;
  try {
    stored = await redis.get(deviceReadinessKey(family));
  } catch {
    return offlineDeviceReadiness();
  }
  if (!stored) return offlineDeviceReadiness();
  try {
    const parsed: unknown = JSON.parse(stored);
    return DeviceReadinessSchema.parse(parsed);
  } catch {
    return offlineDeviceReadiness();
  }
}
