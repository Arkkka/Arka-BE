import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import { z } from 'zod';
import { redisPrefixForFamily, type DeviceFamily } from './family.js';
import { DeviceFeedbackActionSchema, type DeviceServerMessage } from './protocol.js';
const LOCK_TTL_SECONDS = 30;
const STATE_TTL_SECONDS = 3_600;
const COMMAND_ACK_TIMEOUT_MS = 5_000;

function lockKey(family: DeviceFamily): string {
  return `${redisPrefixForFamily(family)}:lock`;
}

function commandQueueKey(family: DeviceFamily): string {
  return `${redisPrefixForFamily(family)}:commands`;
}

function commandSequenceKey(family: DeviceFamily): string {
  return `${redisPrefixForFamily(family)}:command-sequence`;
}

const LockSchema = z
  .object({
    lockId: z.string().uuid(),
    institutionId: z.string().uuid(),
    ownerSessionId: z.string().min(1).max(191),
    holderType: z.enum(['PREPARATION', 'SESSION']),
    preparationId: z.string().min(20).max(128),
    setupId: z.string().uuid(),
    sessionId: z.string().uuid().nullable(),
    state: z.enum(['HELD', 'RELEASING']),
    expiresAtMs: z.number().int().positive(),
  })
  .strict();

const AssociationSchema = z
  .object({
    lockId: z.string().uuid(),
    associationId: z.string().uuid(),
    type: z.enum(['SETUP', 'SESSION']),
    state: z.enum(['BINDING', 'BOUND', 'UNBINDING']),
  })
  .strict();

const CommandSchema = z
  .object({
    commandId: z.string().uuid(),
    lockId: z.string().uuid(),
    associationId: z.string().uuid(),
    sessionId: z.string().uuid().nullable(),
    kind: z.enum(['SETUP_BIND', 'SETUP_UNBIND', 'SESSION_BIND', 'SESSION_UNBIND', 'FEEDBACK']),
    sequence: z.number().int().positive(),
    payload: z.unknown(),
    expiresAtMs: z.number().int().positive(),
    status: z.enum(['PENDING', 'SENT', 'ACKED', 'NACKED']),
    connectionId: z.string().uuid().nullable(),
    bootId: z.string().uuid().nullable(),
    lastDispatchedAtMs: z.number().int().nonnegative().default(0),
    nackReason: z.string().max(80).nullable(),
  })
  .strict();

export type DeviceLock = z.infer<typeof LockSchema>;
export type DeviceAssociation = z.infer<typeof AssociationSchema>;
export type DeviceCommand = z.infer<typeof CommandSchema>;
export type DeviceCommandKind = DeviceCommand['kind'];

const REFRESH_LOCK_SCRIPT = `
local encoded = redis.call('GET', KEYS[1])
if not encoded then return 0 end
local lock = cjson.decode(encoded)
if lock.lockId ~= ARGV[1] then return 0 end
lock.expiresAtMs = tonumber(ARGV[2])
redis.call('SET', KEYS[1], cjson.encode(lock), 'EX', ARGV[3])
return 1
`;

const TRANSITION_LOCK_SCRIPT = `
local encoded = redis.call('GET', KEYS[1])
if not encoded then return 0 end
local lock = cjson.decode(encoded)
if lock.lockId ~= ARGV[1] or lock.ownerSessionId ~= ARGV[2] or lock.holderType ~= ARGV[3] then return 0 end
if ARGV[3] == 'PREPARATION' and lock.preparationId ~= ARGV[4] then return 0 end
if ARGV[3] == 'SESSION' and lock.sessionId ~= ARGV[4] then return 0 end
redis.call('SET', KEYS[1], ARGV[5], 'EX', ARGV[6])
return 1
`;

const RELEASE_LOCK_SCRIPT = `
local encoded = redis.call('GET', KEYS[1])
if not encoded then return 1 end
local lock = cjson.decode(encoded)
if lock.lockId ~= ARGV[1] then return 0 end
redis.call('DEL', KEYS[1])
return 1
`;

const ENQUEUE_COMMAND_SCRIPT = `
local sequence = redis.call('INCR', KEYS[1])
local command = cjson.decode(ARGV[1])
command.sequence = sequence
local encoded = cjson.encode(command)
redis.call('SET', KEYS[2], encoded, 'EX', ARGV[2])
redis.call('ZADD', KEYS[3], sequence, command.commandId)
redis.call('EXPIRE', KEYS[3], ARGV[2])
return encoded
`;
const ENQUEUE_IDEMPOTENT_COMMAND_SCRIPT = `
local existing = redis.call('GET', KEYS[4])
if existing then return existing end
local sequence = redis.call('INCR', KEYS[1])
local command = cjson.decode(ARGV[1])
command.sequence = sequence
local encoded = cjson.encode(command)
redis.call('SET', KEYS[2], encoded, 'EX', ARGV[2])
redis.call('ZADD', KEYS[3], sequence, command.commandId)
redis.call('EXPIRE', KEYS[3], ARGV[2])
redis.call('SET', KEYS[4], encoded, 'EX', ARGV[2])
return encoded
`;
const MARK_COMMAND_DISPATCHED_SCRIPT = `
local encoded = redis.call('GET', KEYS[1])
if not encoded then return nil end
local command = cjson.decode(encoded)
local now = tonumber(ARGV[3])
if command.expiresAtMs <= now or (command.status ~= 'PENDING' and command.status ~= 'SENT') then return nil end
local sameConnection = command.connectionId == ARGV[1] and command.bootId == ARGV[2]
if command.status == 'SENT' and sameConnection and now - command.lastDispatchedAtMs < 1000 then return nil end
command.status = 'SENT'
command.connectionId = ARGV[1]
command.bootId = ARGV[2]
command.lastDispatchedAtMs = now
local updated = cjson.encode(command)
redis.call('SET', KEYS[1], updated, 'EX', ARGV[4])
return updated
`;

function associationKey(
  family: DeviceFamily,
  type: DeviceAssociation['type'],
  associationId: string,
): string {
  return `${redisPrefixForFamily(family)}:association:${type.toLowerCase()}:${associationId}`;
}

function commandKey(family: DeviceFamily, commandId: string): string {
  return `${redisPrefixForFamily(family)}:command:${commandId}`;
}

function handoffKey(family: DeviceFamily, commandId: string): string {
  return `${redisPrefixForFamily(family)}:handoff:${commandId}`;
}

function decode<T>(encoded: string | null, schema: z.ZodType<T>): T | null {
  if (!encoded) return null;
  try {
    return schema.parse(JSON.parse(encoded));
  } catch {
    return null;
  }
}

export async function readDeviceLock(
  redis: Redis,
  family: DeviceFamily,
): Promise<DeviceLock | null> {
  return decode(await redis.get(lockKey(family)), LockSchema);
}

export async function acquireDeviceLock(
  redis: Redis,
  family: DeviceFamily,
  input: Omit<DeviceLock, 'lockId' | 'state' | 'expiresAtMs' | 'sessionId'>,
): Promise<DeviceLock | null> {
  const lock = LockSchema.parse({
    ...input,
    lockId: randomUUID(),
    sessionId: null,
    state: 'HELD',
    expiresAtMs: Date.now() + LOCK_TTL_SECONDS * 1_000,
  });
  const acquired = await redis.set(
    lockKey(family),
    JSON.stringify(lock),
    'EX',
    LOCK_TTL_SECONDS,
    'NX',
  );
  return acquired === 'OK' ? lock : null;
}

export async function refreshDeviceLock(
  redis: Redis,
  family: DeviceFamily,
  lockId: string,
): Promise<boolean> {
  const refreshed = await redis.eval(
    REFRESH_LOCK_SCRIPT,
    1,
    lockKey(family),
    lockId,
    String(Date.now() + LOCK_TTL_SECONDS * 1_000),
    String(LOCK_TTL_SECONDS),
  );
  return Number(refreshed) === 1;
}

export async function transitionDeviceLock(
  redis: Redis,
  family: DeviceFamily,
  current: DeviceLock,
  next: Pick<DeviceLock, 'holderType' | 'sessionId' | 'state'>,
): Promise<DeviceLock | null> {
  const transitioned = LockSchema.parse({
    ...current,
    ...next,
    expiresAtMs: Date.now() + LOCK_TTL_SECONDS * 1_000,
  });
  const currentHolderId =
    current.holderType === 'PREPARATION' ? current.preparationId : current.sessionId;
  if (!currentHolderId) return null;
  const changed = await redis.eval(
    TRANSITION_LOCK_SCRIPT,
    1,
    lockKey(family),
    current.lockId,
    current.ownerSessionId,
    current.holderType,
    currentHolderId,
    JSON.stringify(transitioned),
    String(LOCK_TTL_SECONDS),
  );
  return Number(changed) === 1 ? transitioned : null;
}

export async function releaseDeviceLock(
  redis: Redis,
  family: DeviceFamily,
  lockId: string,
): Promise<boolean> {
  const released = await redis.eval(RELEASE_LOCK_SCRIPT, 1, lockKey(family), lockId);
  return Number(released) === 1;
}

export async function writeDeviceAssociation(
  redis: Redis,
  family: DeviceFamily,
  association: DeviceAssociation,
): Promise<void> {
  const parsed = AssociationSchema.parse(association);
  await redis.set(
    associationKey(family, parsed.type, parsed.associationId),
    JSON.stringify(parsed),
    'EX',
    STATE_TTL_SECONDS,
  );
}

export async function readDeviceAssociation(
  redis: Redis,
  family: DeviceFamily,
  type: DeviceAssociation['type'],
  associationId: string,
): Promise<DeviceAssociation | null> {
  return decode(await redis.get(associationKey(family, type, associationId)), AssociationSchema);
}

export async function updateDeviceAssociationState(
  redis: Redis,
  family: DeviceFamily,
  type: DeviceAssociation['type'],
  associationId: string,
  lockId: string,
  state: DeviceAssociation['state'],
): Promise<boolean> {
  const association = await readDeviceAssociation(redis, family, type, associationId);
  if (!association || association.lockId !== lockId) return false;
  await writeDeviceAssociation(redis, family, { ...association, state });
  return true;
}

export async function deleteDeviceAssociation(
  redis: Redis,
  family: DeviceFamily,
  type: DeviceAssociation['type'],
  associationId: string,
): Promise<void> {
  await redis.del(associationKey(family, type, associationId));
}

export interface EnqueueDeviceCommandInput {
  readonly lockId: string;
  readonly associationId: string;
  readonly sessionId?: string;
  readonly kind: DeviceCommandKind;
  readonly payload: unknown;
  readonly expiresAt: Date;
}

export async function enqueueDeviceCommand(
  redis: Redis,
  family: DeviceFamily,
  input: EnqueueDeviceCommandInput,
): Promise<DeviceCommand> {
  const command = CommandSchema.omit({ sequence: true }).parse({
    commandId: randomUUID(),
    lockId: input.lockId,
    associationId: input.associationId,
    sessionId: input.sessionId ?? null,
    kind: input.kind,
    payload: input.payload,
    expiresAtMs: input.expiresAt.getTime(),
    status: 'PENDING',
    connectionId: null,
    bootId: null,
    lastDispatchedAtMs: 0,
    nackReason: null,
  });
  const ttlSeconds = Math.max(1, Math.ceil((input.expiresAt.getTime() - Date.now()) / 1_000));
  const encoded = await redis.eval(
    ENQUEUE_COMMAND_SCRIPT,
    3,
    commandSequenceKey(family),
    commandKey(family, command.commandId),
    commandQueueKey(family),
    JSON.stringify(command),
    String(Math.max(ttlSeconds, 60)),
  );
  if (typeof encoded !== 'string') throw new Error('Perintah perangkat gagal disimpan');
  return CommandSchema.parse(JSON.parse(encoded));
}

export async function enqueueHandoffDeviceCommand(
  redis: Redis,
  family: DeviceFamily,
  predecessorCommandId: string,
  input: EnqueueDeviceCommandInput,
): Promise<DeviceCommand> {
  const command = CommandSchema.omit({ sequence: true }).parse({
    commandId: randomUUID(),
    lockId: input.lockId,
    associationId: input.associationId,
    sessionId: input.sessionId ?? null,
    kind: input.kind,
    payload: input.payload,
    expiresAtMs: input.expiresAt.getTime(),
    status: 'PENDING',
    connectionId: null,
    bootId: null,
    lastDispatchedAtMs: 0,
    nackReason: null,
  });
  const ttlSeconds = Math.max(1, Math.ceil((input.expiresAt.getTime() - Date.now()) / 1_000));
  const encoded = await redis.eval(
    ENQUEUE_IDEMPOTENT_COMMAND_SCRIPT,
    4,
    commandSequenceKey(family),
    commandKey(family, command.commandId),
    commandQueueKey(family),
    handoffKey(family, predecessorCommandId),
    JSON.stringify(command),
    String(Math.max(ttlSeconds, 60)),
  );
  if (typeof encoded !== 'string') throw new Error('Perintah handoff perangkat gagal disimpan');
  return CommandSchema.parse(JSON.parse(encoded));
}

export async function listDeviceCommands(
  redis: Redis,
  family: DeviceFamily,
  nowMs = Date.now(),
): Promise<DeviceCommand[]> {
  const ids = await redis.zrange(commandQueueKey(family), 0, 31);
  if (ids.length === 0) return [];
  const encoded = await redis.mget(ids.map((id) => commandKey(family, id)));
  const commands: DeviceCommand[] = [];
  const expired: string[] = [];
  for (const [index, value] of encoded.entries()) {
    const command = decode(value, CommandSchema);
    if (!command || command.expiresAtMs <= nowMs || ['ACKED', 'NACKED'].includes(command.status)) {
      expired.push(ids[index]!);
    } else {
      commands.push(command);
    }
  }
  if (expired.length > 0) await redis.zrem(commandQueueKey(family), ...expired);
  return commands;
}

export async function markDeviceCommandDispatched(
  redis: Redis,
  family: DeviceFamily,
  command: DeviceCommand,
  connectionId: string,
  bootId: string,
): Promise<DeviceCommand | null> {
  const encoded = await redis.eval(
    MARK_COMMAND_DISPATCHED_SCRIPT,
    1,
    commandKey(family, command.commandId),
    connectionId,
    bootId,
    String(Date.now()),
    String(STATE_TTL_SECONDS),
  );
  return typeof encoded === 'string' ? CommandSchema.parse(JSON.parse(encoded)) : null;
}

export async function acknowledgeDeviceCommand(
  redis: Redis,
  family: DeviceFamily,
  input: {
    readonly commandId: string;
    readonly associationId: string;
    readonly associationType: DeviceAssociation['type'];
    readonly connectionId: string;
    readonly bootId: string;
    readonly outcome: 'ACK' | 'NACK';
    readonly receivedAtMs?: number;
    readonly reason?: string;
    readonly beforeComplete?: (command: DeviceCommand) => Promise<void>;
  },
): Promise<{ command: DeviceCommand; duplicate: boolean } | null> {
  const command = decode(await redis.get(commandKey(family, input.commandId)), CommandSchema);
  const expectedAssociationType =
    command?.kind === 'SETUP_BIND' || command?.kind === 'SETUP_UNBIND' ? 'SETUP' : 'SESSION';
  if (
    !command ||
    expectedAssociationType !== input.associationType ||
    command.associationId !== input.associationId ||
    command.connectionId !== input.connectionId ||
    command.bootId !== input.bootId ||
    command.lastDispatchedAtMs <= 0
  )
    return null;
  const status = input.outcome === 'ACK' ? 'ACKED' : 'NACKED';
  if (command.status === status && command.nackReason === (input.reason ?? null))
    return { command, duplicate: true };
  if (
    command.status !== 'SENT' ||
    command.lastDispatchedAtMs + COMMAND_ACK_TIMEOUT_MS <= (input.receivedAtMs ?? Date.now())
  )
    return null;
  const [association, lock] = await Promise.all([
    redis
      .get(associationKey(family, input.associationType, input.associationId))
      .then((value) => decode(value, AssociationSchema)),
    readDeviceLock(redis, family),
  ]);
  if (
    !association ||
    !lock ||
    lock.lockId !== command.lockId ||
    association.lockId !== command.lockId
  )
    return null;
  if (input.beforeComplete) await input.beforeComplete(command);
  const updated = CommandSchema.parse({
    ...command,
    status,
    nackReason: input.outcome === 'NACK' ? (input.reason ?? null) : null,
  });
  await redis
    .multi()
    .set(commandKey(family, updated.commandId), JSON.stringify(updated), 'EX', STATE_TTL_SECONDS)
    .zrem(commandQueueKey(family), updated.commandId)
    .exec();
  return { command: updated, duplicate: false };
}

export function commandToWire(command: DeviceCommand, sentAtMs = Date.now()): DeviceServerMessage {
  const base = {
    protocolVersion: 1 as const,
    messageId: randomUUID(),
    sentAtMs,
    sequence: command.sequence,
  };
  if (command.kind === 'SETUP_BIND' || command.kind === 'SETUP_UNBIND') {
    return {
      ...base,
      type: command.kind === 'SETUP_BIND' ? 'setup.bind' : 'setup.unbind',
      payload: {
        commandId: command.commandId,
        reservationId: command.lockId,
        setupId: command.associationId,
      },
    };
  }
  if (command.kind === 'SESSION_BIND' || command.kind === 'SESSION_UNBIND') {
    return {
      ...base,
      type: command.kind === 'SESSION_BIND' ? 'session.bind' : 'session.unbind',
      payload: {
        commandId: command.commandId,
        reservationId: command.lockId,
        sessionId: command.associationId,
      },
    };
  }
  const parsed = z
    .object({
      action: DeviceFeedbackActionSchema,
      expiresAfterMs: z.number().int().min(1).max(1_000),
    })
    .strict()
    .parse(command.payload);
  return {
    ...base,
    type: 'device.feedback',
    payload: {
      commandId: command.commandId,
      sessionId: command.associationId,
      ...parsed,
    },
  };
}

export async function clearDeviceOwnership(
  redis: Redis,
  family: DeviceFamily,
  lockId?: string,
): Promise<boolean> {
  const lock = await readDeviceLock(redis, family);
  if (lockId && lock && lock.lockId !== lockId) return false;
  const queueKey = commandQueueKey(family);
  const commandIds = await redis.zrange(queueKey, 0, -1);
  const keys = [
    queueKey,
    ...(lock
      ? [
          associationKey(family, 'SETUP', lock.setupId),
          ...(lock.sessionId ? [associationKey(family, 'SESSION', lock.sessionId)] : []),
        ]
      : []),
    ...commandIds.map((commandId) => commandKey(family, commandId)),
  ];
  if (keys.length > 0) await redis.del(...keys);
  if (lock) return releaseDeviceLock(redis, family, lock.lockId);
  return true;
}
