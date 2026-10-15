import { createHash } from 'node:crypto';
import type { RequestHandler } from 'express';
import type { RedisClient } from '../db/redis.js';
import { AppError, asyncHandler } from './errors.js';

export interface RateLimitOptions {
  readonly namespace: string;
  readonly limit: number;
  readonly windowSeconds: number;
}

export function rateLimit(redis: RedisClient, options: RateLimitOptions): RequestHandler {
  return asyncHandler(async (req, res, next) => {
    const identity = req.authContext?.sessionId ?? req.ip ?? 'unknown';
    const digest = createHash('sha256').update(identity).digest('base64url');
    const bucket = Math.floor(Date.now() / (options.windowSeconds * 1_000));
    const key = `arka:rate:${options.namespace}:${digest}:${bucket}`;
    const transaction = redis.multi();
    transaction.incr(key);
    transaction.expire(key, options.windowSeconds + 1);
    const replies = await transaction.exec();
    const count = Number(replies?.[0]?.[1] ?? options.limit + 1);
    res.setHeader('RateLimit-Limit', String(options.limit));
    res.setHeader('RateLimit-Remaining', String(Math.max(0, options.limit - count)));
    if (count > options.limit)
      throw new AppError(
        429,
        'rate_limited',
        'Terlalu banyak permintaan. Tunggu sebentar lalu coba lagi.',
      );
    next();
  });
}
