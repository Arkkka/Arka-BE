import type { Redis } from 'ioredis';
import { AppServerMessageSchema, type AppServerMessage } from '../schemas/index.js';

const EVENT_TTL_SECONDS = 3_600;

type Listener = (message: AppServerMessage) => void;

export class RealtimeEventStore {
  readonly #listeners = new Map<string, Set<Listener>>();

  constructor(private readonly redis: Redis) {}

  async publish(
    scope: 'setup' | 'session',
    id: string,
    message: unknown,
  ): Promise<AppServerMessage> {
    const key = `arka:realtime:${scope}:${id}`;
    const sequence = await this.redis.incr(`${key}:sequence`);
    const parsed = AppServerMessageSchema.parse({ ...(message as object), sequence });
    const encoded = JSON.stringify(parsed);
    const transaction = this.redis.multi();
    transaction.del(`${key}:events`);
    transaction.expire(`${key}:sequence`, EVENT_TTL_SECONDS);
    transaction.set(`${key}:snapshot`, encoded, 'EX', EVENT_TTL_SECONDS);
    await transaction.exec();
    for (const listener of this.#listeners.get(key) ?? []) listener(parsed);
    return parsed;
  }

  async replay(
    scope: 'setup' | 'session',
    id: string,
    after = 0,
  ): Promise<readonly AppServerMessage[]> {
    const key = `arka:realtime:${scope}:${id}`;
    const snapshot = await this.redis.get(`${key}:snapshot`);
    if (!snapshot) return [];
    try {
      const message = AppServerMessageSchema.parse(JSON.parse(snapshot));
      return message.sequence > after ? [message] : [];
    } catch {
      return [];
    }
  }

  subscribe(scope: 'setup' | 'session', id: string, listener: Listener): () => void {
    const key = `arka:realtime:${scope}:${id}`;
    const listeners = this.#listeners.get(key) ?? new Set<Listener>();
    listeners.add(listener);
    this.#listeners.set(key, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.#listeners.delete(key);
    };
  }
}
