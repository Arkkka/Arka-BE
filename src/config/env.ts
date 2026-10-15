import { z } from 'zod';

const positiveInt = z.coerce.number().int().positive();
const MAX_TIMER_MS = 2_147_483_647;
const originSchema = z
  .string()
  .url()
  .transform((value, ctx) => {
    const url = new URL(value);
    if (url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
      ctx.addIssue({
        code: 'custom',
        message: 'Origin must not include path, query, credentials, or fragment',
      });
      return z.NEVER;
    }
    return url.origin;
  });

const ollamaUrlSchema = z
  .string()
  .url()
  .transform((value, ctx) => {
    const url = new URL(value);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      ctx.addIssue({
        code: 'custom',
        message:
          'OLLAMA_BASE_URL must be an HTTP(S) server URL without credentials, query, or fragment',
      });
      return z.NEVER;
    }
    return url.toString().replace(/\/$/u, '');
  });

function deviceSecretSchema(name: string) {
  return z.preprocess(
    (value) => (value === '' ? undefined : value),
    z
      .string()
      .transform((encoded, ctx) => {
        const secret = Buffer.from(encoded, 'base64');
        if (
          secret.length < 32 ||
          secret.length > 64 ||
          secret.toString('base64').replace(/=+$/u, '') !== encoded.replace(/=+$/u, '')
        ) {
          ctx.addIssue({
            code: 'custom',
            message: `${name} must be canonical base64 for 32 to 64 bytes`,
          });
          return z.NEVER;
        }
        return secret;
      })
      .optional(),
  );
}

const rawEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z
    .string()
    .url()
    .refine((value) => /^postgres(ql)?:\/\//u.test(value), 'DATABASE_URL must be PostgreSQL'),
  REDIS_URL: z
    .string()
    .url()
    .refine((value) => /^rediss?:\/\//u.test(value), 'REDIS_URL must use redis:// or rediss://'),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().url(),
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535),
  SMTP_SECURE: z.stringbool(),
  SMTP_USER: z.string().email(),
  SMTP_PASSWORD: z.string().min(1),
  SMTP_CONNECTION_TIMEOUT_MS: positiveInt.max(30_000).default(8_000),
  SMTP_GREETING_TIMEOUT_MS: positiveInt.max(30_000).default(5_000),
  SMTP_SOCKET_TIMEOUT_MS: positiveInt.max(60_000).default(15_000),
  BROWSER_ORIGINS: z.string().min(1),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  PREPARATION_TTL_MS: positiveInt.default(300_000),
  BINDING_DEADLINE_MS: positiveInt.default(20_000),
  IDEMPOTENCY_TTL_MS: positiveInt.default(86_400_000),
  DEVICE_COMMAND_TTL_MS: positiveInt.default(30_000),
  DEVICE_SECRET_BASE64: deviceSecretSchema('DEVICE_SECRET_BASE64'),
  OLLAMA_PROVIDER: z.enum(['ollama', 'openai']).default('ollama'),
  OLLAMA_BASE_URL: ollamaUrlSchema,
  OLLAMA_API_KEY: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().min(1).optional(),
  ),
  OLLAMA_MODEL: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[A-Za-z0-9_.:/-]+$/u),
  OLLAMA_MODEL_ALLOWLIST: z.string().min(1),
  OLLAMA_TIMEOUT_MS: positiveInt.max(MAX_TIMER_MS).default(120_000),
  OLLAMA_WORKER_INTERVAL_MS: positiveInt.max(MAX_TIMER_MS).default(5_000),
  OLLAMA_LEASE_MS: positiveInt.max(MAX_TIMER_MS).default(30_000),
  OLLAMA_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
});

export type Env = Omit<
  z.infer<typeof rawEnvSchema>,
  'BROWSER_ORIGINS' | 'OLLAMA_MODEL_ALLOWLIST' | 'GOOGLE_CLIENT_ID' | 'GOOGLE_CLIENT_SECRET'
> & {
  readonly browserOrigins: readonly string[];
  readonly googleOAuth: Readonly<{ clientId: string; clientSecret: string }> | null;
};

export function parseEnv(source: NodeJS.ProcessEnv): Env {
  const parsed = rawEnvSchema.parse(source);
  const browserOrigins = z
    .array(originSchema)
    .min(1)
    .parse(
      parsed.BROWSER_ORIGINS.split(',')
        .map((value) => value.trim())
        .filter(Boolean),
    );
  const ollamaModelAllowlist = new Set(
    parsed.OLLAMA_MODEL_ALLOWLIST.split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );
  if (!ollamaModelAllowlist.has(parsed.OLLAMA_MODEL)) {
    throw new Error('OLLAMA_MODEL must be present in OLLAMA_MODEL_ALLOWLIST');
  }
  const ollamaUrl = new URL(parsed.OLLAMA_BASE_URL);
  if (parsed.OLLAMA_PROVIDER === 'openai') {
    if (!parsed.OLLAMA_API_KEY) throw new Error('OLLAMA_API_KEY is required for the openai provider');
    if (ollamaUrl.protocol !== 'https:') throw new Error('OLLAMA_BASE_URL must use HTTPS for the openai provider');
  } else {
    const hostname = ollamaUrl.hostname.toLowerCase();
    const privateHost =
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname.endsWith('.internal') ||
      hostname.endsWith('.local') ||
      /^10\./u.test(hostname) ||
      /^192\.168\./u.test(hostname) ||
      /^172\.(1[6-9]|2\d|3[01])\./u.test(hostname);
    if (!privateHost) {
      throw new Error('OLLAMA_BASE_URL must resolve through an explicitly private hostname or address');
    }
  }
  const authOrigin = new URL(parsed.BETTER_AUTH_URL).origin;
  if (parsed.NODE_ENV === 'production' && new URL(parsed.BETTER_AUTH_URL).protocol !== 'https:') {
    throw new Error('BETTER_AUTH_URL must use HTTPS in production');
  }
  if (!browserOrigins.includes(authOrigin)) {
    throw new Error('BETTER_AUTH_URL origin must be included in BROWSER_ORIGINS');
  }
  const hasGoogleClientId = parsed.GOOGLE_CLIENT_ID !== undefined;
  const hasGoogleClientSecret = parsed.GOOGLE_CLIENT_SECRET !== undefined;
  if (hasGoogleClientId !== hasGoogleClientSecret) {
    throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be configured together');
  }
  const googleOAuth =
    parsed.GOOGLE_CLIENT_ID && parsed.GOOGLE_CLIENT_SECRET
      ? Object.freeze({
          clientId: parsed.GOOGLE_CLIENT_ID,
          clientSecret: parsed.GOOGLE_CLIENT_SECRET,
        })
      : null;
  const rest = { ...parsed };
  Reflect.deleteProperty(rest, 'BROWSER_ORIGINS');
  Reflect.deleteProperty(rest, 'OLLAMA_MODEL_ALLOWLIST');
  Reflect.deleteProperty(rest, 'GOOGLE_CLIENT_ID');
  Reflect.deleteProperty(rest, 'GOOGLE_CLIENT_SECRET');
  return Object.freeze({
    ...rest,
    browserOrigins: Object.freeze(browserOrigins),
    googleOAuth,
  });
}

export const env = parseEnv(process.env);
