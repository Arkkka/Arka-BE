import pino, { type Logger as PinoLogger } from 'pino';
import type { Env } from './env.js';

export type Logger = PinoLogger;

const REDACT_PATHS = [
  'password',
  '*.password',
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'token',
  '*.token',
  'secret',
  '*.secret',
  'credential',
  '*.credential',
  'credentialCiphertext',
  '*.credentialCiphertext',
  'proof',
  '*.proof',
  'participantReference',
  '*.participantReference',
  'displayName',
  '*.displayName',
  'telemetry',
  '*.telemetry',
  'fsrRaw',
  '*.fsrRaw',
  'prompt',
  '*.prompt',
  'response',
  '*.response',
  'email',
  '*.email',
  'name',
  '*.name',
  'image',
  '*.image',
  'participantId',
  '*.participantId',
  'sessionId',
  '*.sessionId',
  'metrics',
  '*.metrics',
  'summaryText',
  '*.summaryText',
  'observations',
  '*.observations',
  'userId',
  '*.userId',
  'institutionId',
  '*.institutionId',
  'deviceId',
  '*.deviceId',
  'preparationId',
  '*.preparationId',
];

const SENSITIVE_KEY =
  /(?:authorization|cookie|password|secret|token|apikey|otp|buffer|credential|proof|participantreference|participantid|displayname|telemetry|fsrraw|prompt|response|email|name|image|sessionid|metrics|summarytext|observations|userid|institutionid|deviceid|preparationid)/iu;

function redactValue(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Buffer.isBuffer(value)) return '[REDACTED]';
  if (value instanceof Error)
    return { name: value.name, message: value.message, stack: value.stack };
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => redactValue(item, seen));
  const redacted: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    redacted[key] = SENSITIVE_KEY.test(key.replace(/[^a-z]/giu, ''))
      ? '[REDACTED]'
      : redactValue(item, seen);
  }
  return redacted;
}

export function redactOperationalValue(value: unknown): unknown {
  return redactValue(value, new WeakSet());
}

export function createLogger(env: Env): Logger {
  return pino({
    level: env.LOG_LEVEL,
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    base: { service: 'arka-backend', environment: env.NODE_ENV },
    formatters: {
      log: (bindings) => redactOperationalValue(bindings) as Record<string, unknown>,
    },
    serializers: {
      err: pino.stdSerializers.err,
      req: (request: { method?: string; url?: string; id?: string }) => ({
        id: request.id,
        method: request.method,
        path: request.url?.split('?', 1)[0],
      }),
      res: (response: { statusCode?: number }) => ({ statusCode: response.statusCode }),
    },
  });
}
