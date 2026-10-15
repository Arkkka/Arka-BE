import type { RedisClient } from '../../db/redis.js';
import { readDeviceLock } from '../../device/commands.js';
import { DEVICE_FAMILIES, type DeviceFamily } from '../../device/family.js';
import {
  deviceIdForFamily,
  deviceLabelForFamily,
  readDeviceReadiness,
  type DeviceReadiness,
} from '../../device/readiness.js';

export interface DeviceRecord {
  readonly deviceId: string;
  readonly family: DeviceFamily;
  readonly label: string;
  readonly inventoryStatus: 'ACTIVE';
  readonly firmwareVersion: string | null;
  readonly capabilitySnapshot: readonly string[];
  readonly reservation: { readonly state: 'HELD' | 'RELEASING' } | null;
}

export interface DeviceSnapshot {
  readonly device: DeviceRecord;
  readonly readiness: DeviceReadiness;
}

export class DeviceRepository {
  constructor(private readonly redis: RedisClient) {}

  async listInstitutionDevices(_institutionId: string): Promise<DeviceSnapshot[]> {
    return Promise.all(DEVICE_FAMILIES.map((family) => this.readFamilySnapshot(family)));
  }

  private async readFamilySnapshot(family: DeviceFamily): Promise<DeviceSnapshot> {
    const [readiness, lock] = await Promise.all([
      readDeviceReadiness(this.redis, family),
      readDeviceLock(this.redis, family),
    ]);
    return {
      device: {
        deviceId: deviceIdForFamily(family),
        family,
        label: deviceLabelForFamily(family),
        inventoryStatus: 'ACTIVE',
        firmwareVersion: readiness.firmwareVersion,
        capabilitySnapshot: readiness.capabilities,
        reservation: lock ? { state: lock.state } : null,
      },
      readiness,
    };
  }
}
