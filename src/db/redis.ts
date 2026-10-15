import { Redis } from 'ioredis';
import type { Env } from '../config/env.js';
import type { Logger } from '../config/logger.js';

export type RedisClient = Redis;

export function createRedis(env: Env, logger: Logger): RedisClient {
  const redis = new Redis(env.REDIS_URL, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    retryStrategy: (attempt: number) => Math.min(attempt * 250, 2_000),
  });
  redis.on('error', (error: Error) => logger.error({ err: error }, 'Redis connection error'));
  return redis;
}

export async function connectRedis(redis: RedisClient): Promise<void> {
  if (redis.status === 'wait') await redis.connect();
  if ((await redis.ping()) !== 'PONG') throw new Error('Redis did not acknowledge readiness probe');
}

export function isRedisConnected(redis: RedisClient): boolean {
  return redis.status === 'ready';
}
