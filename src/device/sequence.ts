import type { Redis } from 'ioredis';
import { redisPrefixForFamily, type DeviceFamily } from './family.js';
import type { AuthenticatedDeviceMessage } from './protocol.js';
import { DEVICE_MAX_MESSAGES_PER_SECOND, DEVICE_MAX_SEQUENCE_GAP } from './protocol.js';

export type DeviceSequenceDecision =
  | 'ACCEPT'
  | 'DUPLICATE'
  | 'STALE'
  | 'GAP'
  | 'RATE_LIMITED'
  | 'TELEMETRY_DROPPED';

const ENFORCE_SEQUENCE_SCRIPT = `
local sequenceKey = KEYS[1]
local messageKey = KEYS[2]
local rateKey = KEYS[3]
local fsrRateKey = KEYS[4]
local proposed = tonumber(ARGV[1])
local maxGap = tonumber(ARGV[2])
local maxRate = tonumber(ARGV[3])
local fsr = ARGV[4] == '1'
local current = tonumber(redis.call('GET', sequenceKey) or '0')
if redis.call('EXISTS', messageKey) == 1 then return 'DUPLICATE' end
if proposed <= current then return 'STALE' end
if proposed - current > maxGap and ARGV[5] ~= '1' then return 'GAP' end
local rate = redis.call('INCR', rateKey)
if rate == 1 then redis.call('EXPIRE', rateKey, 2) end
if rate > maxRate then return 'RATE_LIMITED' end
local telemetryDropped = false
if fsr then
  local fsrRate = redis.call('INCR', fsrRateKey)
  if fsrRate == 1 then redis.call('EXPIRE', fsrRateKey, 2) end
  telemetryDropped = fsrRate > 10
end
redis.call('SET', sequenceKey, proposed, 'EX', 86400)
redis.call('SET', messageKey, '1', 'EX', 300)
if telemetryDropped then return 'TELEMETRY_DROPPED' end
return 'ACCEPT'
`;

export async function enforceDeviceSequence(
  redis: Redis,
  family: DeviceFamily,
  bootId: string,
  message: AuthenticatedDeviceMessage,
  receivedAtMs = Date.now(),
  allowForwardResync = false,
): Promise<DeviceSequenceDecision> {
  const prefix = `${redisPrefixForFamily(family)}:device:boot:${bootId}`;
  const second = Math.floor(receivedAtMs / 1_000);
  const result = await redis.eval(
    ENFORCE_SEQUENCE_SCRIPT,
    4,
    `${prefix}:sequence`,
    `${prefix}:message:${message.messageId}`,
    `${prefix}:rate:${second}`,
    `${prefix}:fsr:${second}`,
    String(message.sequence),
    String(DEVICE_MAX_SEQUENCE_GAP),
    String(DEVICE_MAX_MESSAGES_PER_SECOND),
    message.type === 'telemetry.fsr' ? '1' : '0',
    allowForwardResync ? '1' : '0',
  );
  if (
    result === 'ACCEPT' ||
    result === 'DUPLICATE' ||
    result === 'STALE' ||
    result === 'GAP' ||
    result === 'RATE_LIMITED' ||
    result === 'TELEMETRY_DROPPED'
  )
    return result;
  throw new Error('Hasil pemeriksaan urutan perangkat tidak dikenal');
}
