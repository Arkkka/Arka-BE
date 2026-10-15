import { z } from 'zod';

export const DEVICE_PROTOCOL_VERSION = 1 as const;
export const DEVICE_SUBPROTOCOL = 'arka-device-v1' as const;
export const DEVICE_MAX_MESSAGE_BYTES = 16 * 1024;
export const DEVICE_MAX_MESSAGES_PER_SECOND = 25;
export const DEVICE_MAX_SEQUENCE_GAP = 32;
export const DEVICE_HEARTBEAT_INTERVAL_MS = 5_000;
export const DEVICE_STALE_AFTER_MS = 45_000;

const Uuid = z.string().uuid();
const Sequence = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const SentAt = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const MessageId = Uuid;
const Capability = z.enum(['FSR_10HZ', 'FSR_TARED_ON_SETUP_BIND', 'BUTTONS_4', 'LED', 'HAPTIC']);
export const DeviceButtonCodeSchema = z.enum(['RED', 'GREEN', 'BLUE', 'YELLOW', 'MULTIPLE']);
export const DeviceFaultSchema = z.enum(['FSR', 'BUTTON', 'CABLE', 'ACTUATOR']);
export const DeviceAckReasonSchema = z.enum([
  'INVALID_ASSOCIATION',
  'UNSUPPORTED',
  'EXPIRED',
  'BUSY',
  'FAULT',
  'INVALID_COMMAND',
]);
export const DeviceFeedbackActionSchema = z.enum([
  'LED_SUCCESS',
  'HAPTIC_SUCCESS',
  'LED_CORRECT',
  'LED_INCORRECT',
  'LED_YELLOW',
  'LED_GREEN',
  'LED_RED',
  'LED_BLUE',
  'HAPTIC_PULSE',
  'HARD_STOP',
]);
const HAPTIC_FEEDBACK_ACTIONS = new Set(['HAPTIC_SUCCESS', 'HAPTIC_PULSE']);

const ClientBase = z
  .object({
    protocolVersion: z.literal(DEVICE_PROTOCOL_VERSION),
    type: z.string(),
    messageId: MessageId,
    sentAtMs: SentAt,
    sequence: Sequence,
  })
  .strict();

export const DeviceHelloSchema = ClientBase.extend({
  type: z.literal('device.hello'),
  sequence: z.literal(0),
  bootId: Uuid,
  payload: z
    .object({
      firmwareVersion: z.string().min(1).max(80),
      capabilities: z
        .array(Capability)
        .min(1)
        .max(5)
        .refine((values) => new Set(values).size === values.length),
    })
    .strict(),
}).strict();
export type DeviceHello = z.infer<typeof DeviceHelloSchema>;

export const DeviceChallengeSchema = z
  .object({
    protocolVersion: z.literal(DEVICE_PROTOCOL_VERSION),
    type: z.literal('device.challenge'),
    messageId: MessageId,
    sequence: z.literal(0),
    sentAtMs: SentAt,
    payload: z
      .object({
        challengeId: Uuid,
        nonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
        expiresAtMs: SentAt,
      })
      .strict(),
  })
  .strict();
export type DeviceChallenge = z.infer<typeof DeviceChallengeSchema>;

export const DeviceProveSchema = ClientBase.extend({
  type: z.literal('device.prove'),
  sequence: z.literal(0),
  payload: z
    .object({
      challengeId: Uuid,
      proof: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    })
    .strict(),
}).strict();
export type DeviceProve = z.infer<typeof DeviceProveSchema>;

export const DeviceAcceptSchema = z
  .object({
    protocolVersion: z.literal(DEVICE_PROTOCOL_VERSION),
    type: z.literal('device.accept'),
    messageId: MessageId,
    sequence: z.literal(0),
    sentAtMs: SentAt,
    payload: z
      .object({
        connectionId: Uuid,
        heartbeatIntervalMs: z.literal(DEVICE_HEARTBEAT_INTERVAL_MS),
        maxSequenceGap: z.literal(DEVICE_MAX_SEQUENCE_GAP),
      })
      .strict(),
  })
  .strict();
export type DeviceAccept = z.infer<typeof DeviceAcceptSchema>;

const BatterySchema = z
  .object({
    valid: z.boolean(),
    percent: z.number().int().min(0).max(100).optional(),
  })
  .strict()
  .superRefine((battery, context) => {
    if (battery.valid !== (battery.percent !== undefined)) {
      context.addIssue({
        code: 'custom',
        message: 'Valid battery status requires percent; invalid status forbids it',
      });
    }
  });
const HealthPayloadSchema = z
  .object({ battery: BatterySchema, faults: z.array(DeviceFaultSchema).max(4) })
  .strict();
export type DeviceHealthPayload = z.infer<typeof HealthPayloadSchema>;

const AuthenticatedBase = z
  .object({
    protocolVersion: z.literal(DEVICE_PROTOCOL_VERSION),
    type: z.string(),
    messageId: MessageId,
    sentAtMs: SentAt,
    sequence: Sequence.refine((value) => value >= 1, 'Authenticated sequence starts at one'),
  })
  .strict();

export const DeviceHeartbeatSchema = AuthenticatedBase.extend({
  type: z.literal('device.heartbeat'),
  payload: HealthPayloadSchema,
}).strict();
export const DeviceStatusSchema = AuthenticatedBase.extend({
  type: z.literal('device.status'),
  payload: HealthPayloadSchema,
}).strict();
const FsrMessageBase = AuthenticatedBase.extend({
  type: z.literal('telemetry.fsr'),
  payload: z.object({ fsrRaw: z.number().int().min(0).max(4095) }).strict(),
});
export const DeviceFsrSchema = z.union([
  FsrMessageBase.extend({ setupId: Uuid }).strict(),
  FsrMessageBase.extend({ sessionId: Uuid }).strict(),
]);
const ButtonMessageBase = AuthenticatedBase.extend({
  type: z.literal('button.press'),
  payload: z.object({ buttonCode: DeviceButtonCodeSchema }).strict(),
});
export const DeviceButtonPressSchema = z.union([
  ButtonMessageBase.extend({ setupId: Uuid }).strict(),
  ButtonMessageBase.extend({ sessionId: Uuid }).strict(),
]);
const CommandAckMessageBase = AuthenticatedBase.extend({
  type: z.literal('device.commandAck'),
  payload: z
    .object({
      commandId: Uuid,
      outcome: z.enum(['ACK', 'NACK']),
      reason: DeviceAckReasonSchema.optional(),
    })
    .strict()
    .superRefine((ack, context) => {
      if (ack.outcome === 'ACK' && ack.reason !== undefined) {
        context.addIssue({ code: 'custom', message: 'ACK does not carry a reason' });
      }
      if (ack.outcome === 'NACK' && ack.reason === undefined) {
        context.addIssue({ code: 'custom', message: 'NACK requires a reason' });
      }
    }),
});
export const DeviceCommandAckSchema = z.union([
  CommandAckMessageBase.extend({ setupId: Uuid }).strict(),
  CommandAckMessageBase.extend({ sessionId: Uuid }).strict(),
]);

export const AuthenticatedDeviceMessageSchema = z.union([
  DeviceHeartbeatSchema,
  DeviceStatusSchema,
  DeviceFsrSchema,
  DeviceButtonPressSchema,
  DeviceCommandAckSchema,
]);
export type AuthenticatedDeviceMessage = z.infer<typeof AuthenticatedDeviceMessageSchema>;
export const DeviceClientMessageSchema = z.union([
  DeviceHelloSchema,
  DeviceProveSchema,
  AuthenticatedDeviceMessageSchema,
]);
export type DeviceClientMessage = z.infer<typeof DeviceClientMessageSchema>;

const ServerCommandBase = z
  .object({
    protocolVersion: z.literal(DEVICE_PROTOCOL_VERSION),
    type: z.string(),
    messageId: MessageId,
    sentAtMs: SentAt,
    sequence: Sequence.refine((value) => value >= 1),
  })
  .strict();
const CommandIdentity = { commandId: Uuid, reservationId: Uuid } as const;
export const SetupBindCommandSchema = ServerCommandBase.extend({
  type: z.literal('setup.bind'),
  payload: z.object({ ...CommandIdentity, setupId: Uuid }).strict(),
}).strict();
export const SetupUnbindCommandSchema = ServerCommandBase.extend({
  type: z.literal('setup.unbind'),
  payload: z.object({ ...CommandIdentity, setupId: Uuid }).strict(),
}).strict();
export const SessionBindCommandSchema = ServerCommandBase.extend({
  type: z.literal('session.bind'),
  payload: z.object({ ...CommandIdentity, sessionId: Uuid }).strict(),
}).strict();
export const SessionUnbindCommandSchema = ServerCommandBase.extend({
  type: z.literal('session.unbind'),
  payload: z.object({ ...CommandIdentity, sessionId: Uuid }).strict(),
}).strict();
export const DeviceFeedbackPayloadSchema = z
  .object({
    commandId: Uuid,
    sessionId: Uuid,
    action: DeviceFeedbackActionSchema,
    expiresAfterMs: z.number().int().min(1).max(1_000),
  })
  .strict()
  .superRefine((feedback, context) => {
    if (HAPTIC_FEEDBACK_ACTIONS.has(feedback.action) && feedback.expiresAfterMs > 250) {
      context.addIssue({
        code: 'custom',
        path: ['expiresAfterMs'],
        message: 'Haptic feedback is limited to 250 ms',
      });
    }
  });
export const DeviceFeedbackCommandSchema = ServerCommandBase.extend({
  type: z.literal('device.feedback'),
  payload: DeviceFeedbackPayloadSchema,
}).strict();
export const DeviceServerMessageSchema = z.union([
  DeviceChallengeSchema,
  DeviceAcceptSchema,
  SetupBindCommandSchema,
  SetupUnbindCommandSchema,
  SessionBindCommandSchema,
  SessionUnbindCommandSchema,
  DeviceFeedbackCommandSchema,
]);
export type DeviceServerMessage = z.infer<typeof DeviceServerMessageSchema>;

export function encodeDeviceServerMessage(message: DeviceServerMessage): string {
  return JSON.stringify(DeviceServerMessageSchema.parse(message));
}

export class DeviceProtocolError extends Error {
  readonly code: 'MESSAGE_TOO_LARGE' | 'MALFORMED_JSON' | 'INVALID_MESSAGE';

  constructor(code: DeviceProtocolError['code']) {
    super(code);
    this.name = 'DeviceProtocolError';
    this.code = code;
  }
}

export function parseDeviceMessage(
  data: string | Buffer,
): z.infer<typeof DeviceClientMessageSchema> {
  const bytes = typeof data === 'string' ? Buffer.byteLength(data) : data.byteLength;
  if (bytes > DEVICE_MAX_MESSAGE_BYTES) throw new DeviceProtocolError('MESSAGE_TOO_LARGE');
  let input: unknown;
  try {
    input = JSON.parse(typeof data === 'string' ? data : data.toString('utf8'));
  } catch {
    throw new DeviceProtocolError('MALFORMED_JSON');
  }
  const parsed = DeviceClientMessageSchema.safeParse(input);
  if (!parsed.success) throw new DeviceProtocolError('INVALID_MESSAGE');
  return parsed.data;
}
