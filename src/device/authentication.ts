import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Redis } from 'ioredis';
import { redisPrefixForFamily, type DeviceFamily } from './family.js';
import { DEVICE_SUBPROTOCOL, type DeviceHello, type DeviceProve } from './protocol.js';

const CHALLENGE_TTL_SECONDS = 15;

function challengeKey(family: DeviceFamily, challengeId: string): string {
  return `${redisPrefixForFamily(family)}:challenge:${challengeId}`;
}

export interface DeviceChallengeRecord {
  readonly challengeId: string;
  readonly nonce: string;
  readonly expiresAtMs: number;
}

export async function issueDeviceChallenge(
  redis: Redis,
  family: DeviceFamily,
  hello: DeviceHello,
  nowMs = Date.now(),
): Promise<DeviceChallengeRecord> {
  const record = {
    challengeId: randomUUID(),
    nonce: randomBytes(32).toString('base64url'),
    expiresAtMs: nowMs + CHALLENGE_TTL_SECONDS * 1_000,
  };
  const stored = JSON.stringify({
    bootId: hello.bootId,
    nonce: record.nonce,
    expiresAtMs: record.expiresAtMs,
  });
  const accepted = await redis.set(
    challengeKey(family, record.challengeId),
    stored,
    'EX',
    CHALLENGE_TTL_SECONDS,
    'NX',
  );
  if (accepted !== 'OK') throw new Error('Gagal membuat tantangan perangkat');
  return record;
}

export async function verifyDeviceProof(
  redis: Redis,
  family: DeviceFamily,
  prove: DeviceProve,
  hello: DeviceHello,
  secret: Buffer,
  nowMs = Date.now(),
): Promise<boolean> {
  const encoded = await redis.call('GETDEL', challengeKey(family, prove.payload.challengeId));
  if (typeof encoded !== 'string') return false;
  let record: { bootId: string; nonce: string; expiresAtMs: number };
  try {
    record = JSON.parse(encoded) as typeof record;
  } catch {
    return false;
  }
  if (record.expiresAtMs < nowMs || record.bootId !== hello.bootId) return false;
  const material = `${DEVICE_SUBPROTOCOL}\n${prove.payload.challengeId}\n${record.nonce}\n${hello.bootId}`;
  const expected = createHmac('sha256', secret).update(material).digest();
  let supplied: Buffer;
  try {
    supplied = Buffer.from(prove.payload.proof, 'base64url');
  } catch {
    return false;
  }
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
