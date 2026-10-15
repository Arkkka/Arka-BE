import type { IncomingHttpHeaders } from 'node:http';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { Env } from '../config/env.js';

export interface RealtimeAuthSession {
  readonly session: { readonly id: string };
  readonly user: { readonly id: string; readonly institutionId?: string | null | undefined };
}

export interface RealtimeAuth {
  readonly api: {
    getSession(input: { headers: Headers }): Promise<RealtimeAuthSession | null>;
  };
}

export interface RealtimeDependencies {
  readonly prisma: PrismaClient;
  readonly redis: Redis;
  readonly auth: RealtimeAuth;
  readonly env: Env;
  readonly logger: Logger;
  readonly validateSession: (
    sessionId: string,
    userId: string,
    institutionId: string,
  ) => Promise<boolean>;
}

export type RuntimeDependencies = Pick<RealtimeDependencies, 'prisma' | 'redis' | 'logger'>;

export function webHeaders(headers: IncomingHttpHeaders): Headers {
  const result = new Headers();
  for (const [name, raw] of Object.entries(headers)) {
    if (Array.isArray(raw)) {
      for (const value of raw) result.append(name, value);
    } else if (raw !== undefined) {
      result.set(name, raw);
    }
  }
  return result;
}
