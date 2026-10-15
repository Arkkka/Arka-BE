import { z } from 'zod';
import type { DeviceSnapshot } from './device.repository.js';
import type { DeviceRepository } from './device.repository.js';
import { DeviceDtoSchema, type DeviceDto } from './device.validation.js';

const StoredCapabilitiesSchema = z.array(z.string()).max(16);

const READINESS_MESSAGES: Readonly<Record<DeviceDto['readinessCode'], string>> = {
  READY: 'Perangkat siap digunakan.',
  OFFLINE: 'Perangkat sedang offline.',
  NOT_ACTIVE: 'Perangkat tidak aktif.',
  NOT_COMPATIBLE: 'Perangkat belum kompatibel dengan permainan.',
  RESERVED: 'Perangkat sedang digunakan.',
  CLEANUP_PENDING: 'Perangkat sedang menyelesaikan sesi sebelumnya.',
  NOT_READY_BATTERY_UNKNOWN: 'Status baterai perangkat belum tersedia.',
  NOT_READY_LOW_BATTERY: 'Baterai perangkat terlalu rendah.',
  DEVICE_FAULT: 'Perangkat memerlukan pemeriksaan pengelola.',
};

function publicCapabilities(values: readonly string[]): DeviceDto['capabilities'] {
  const result: DeviceDto['capabilities'] = [];
  if (values.includes('FSR_10HZ')) result.push('FSR');
  if (values.includes('BUTTONS_4')) result.push('BUTTONS_4');
  if (values.includes('LED')) result.push('LED');
  if (values.includes('HAPTIC')) result.push('HAPTIC');
  return result;
}

function effectiveReadinessCode(snapshot: DeviceSnapshot): DeviceDto['readinessCode'] {
  if (snapshot.device.reservation?.state === 'RELEASING') return 'CLEANUP_PENDING';
  if (snapshot.device.reservation?.state === 'HELD') return 'RESERVED';
  return snapshot.readiness.readinessCode;
}

export function mapDeviceSnapshot(snapshot: DeviceSnapshot): DeviceDto {
  const storedCapabilities = StoredCapabilitiesSchema.safeParse(snapshot.device.capabilitySnapshot);
  const capabilities =
    snapshot.readiness.capabilities.length > 0
      ? snapshot.readiness.capabilities
      : storedCapabilities.success
        ? storedCapabilities.data
        : [];
  const readinessCode = effectiveReadinessCode(snapshot);
  return DeviceDtoSchema.parse({
    deviceId: snapshot.device.deviceId,
    family: snapshot.device.family,
    label: snapshot.device.label,
    inventoryStatus: snapshot.device.inventoryStatus,
    connectionStatus: snapshot.readiness.connectionStatus,
    readinessCode,
    readinessMessage: READINESS_MESSAGES[readinessCode],
    firmwareVersion: snapshot.readiness.firmwareVersion ?? snapshot.device.firmwareVersion,
    capabilities: publicCapabilities(capabilities),
    batteryPercent: snapshot.readiness.batteryPercent,
    lastSeenAt: snapshot.readiness.lastSeenAt,
  });
}

export class DeviceService {
  constructor(private readonly repository: DeviceRepository) {}

  async list(institutionId: string): Promise<DeviceDto[]> {
    const snapshots = await this.repository.listInstitutionDevices(institutionId);
    return snapshots.map(mapDeviceSnapshot);
  }
}
