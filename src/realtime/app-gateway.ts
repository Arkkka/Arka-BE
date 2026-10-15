import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import {
  AppClientMessageSchema,
  AppServerMessageSchema,
  type AppServerMessage,
} from '../schemas/index.js';
import WebSocket, { WebSocketServer, type RawData } from 'ws';
import type { AuthoritativeRuntime } from './runtime.js';
import { webHeaders, type RealtimeAuthSession, type RealtimeDependencies } from './types.js';

const APP_MAX_MESSAGE_BYTES = 16 * 1024;
const APP_MAX_CONNECTIONS_PER_SESSION = 4;
const APP_MAX_MESSAGES_PER_SECOND = 20;
const APP_PING_INTERVAL_MS = 5_000;
const APP_STALE_AFTER_MS = 15_000;
const APP_CONNECTION_TTL_SECONDS = 20;
const AUTHORIZATION_CACHE_MS = 5_000;
const ACQUIRE_APP_CONNECTION_SCRIPT = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[2]) then return 0 end
redis.call('ZADD', KEYS[1], ARGV[3], ARGV[4])
redis.call('EXPIRE', KEYS[1], ARGV[5])
return 1
`;
const REFRESH_APP_CONNECTION_SCRIPT = `
if redis.call('ZSCORE', KEYS[1], ARGV[1]) == false then return 0 end
redis.call('ZADD', KEYS[1], ARGV[2], ARGV[1])
redis.call('EXPIRE', KEYS[1], ARGV[3])
return 1
`;
const APP_MESSAGE_RATE_SCRIPT = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then redis.call('EXPIRE', KEYS[1], 2) end
return current
`;

type OnboardedRealtimeAuthSession = RealtimeAuthSession & {
  readonly user: RealtimeAuthSession['user'] & { readonly institutionId: string };
};

interface AuthorizedUpgrade {
  readonly auth: OnboardedRealtimeAuthSession;
  readonly connectionId: string;
}

type Scope = 'setup' | 'session';

interface Subscription {
  readonly scope: Scope;
  readonly id: string;
  lastSequence: number;
  replaying: boolean;
  buffered: AppServerMessage | null;
  pending: AppServerMessage | null;
  sending: boolean;
  unsubscribe: () => void;
}

interface AppConnection {
  readonly socket: WebSocket;
  readonly cleanup: () => Promise<void>;
}

function rejectedReason(result: PromiseRejectedResult): unknown {
  return result.reason as unknown;
}

function rawDataBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data);
}

function sendValidated(socket: WebSocket, message: unknown): void {
  if (socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(AppServerMessageSchema.parse(message)));
}

function sendError(socket: WebSocket, code: string, message: string): void {
  sendValidated(socket, {
    protocolVersion: 1,
    type: 'app.error',
    sequence: 0,
    payload: { code, message },
  });
}

async function authenticate(
  request: IncomingMessage,
  dependencies: RealtimeDependencies,
): Promise<OnboardedRealtimeAuthSession | null> {
  const auth = await dependencies.auth.api.getSession({ headers: webHeaders(request.headers) });
  if (!auth) return null;
  const user = await dependencies.prisma.msUser.findUnique({
    where: { id: auth.user.id },
    select: { institutionId: true },
  });
  const institutionId = user?.institutionId;
  if (
    !institutionId ||
    !(await dependencies.validateSession(auth.session.id, auth.user.id, institutionId))
  ) {
    return null;
  }
  return { ...auth, user: { ...auth.user, institutionId } };
}

async function ownsScope(
  scope: Scope,
  id: string,
  auth: OnboardedRealtimeAuthSession,
  dependencies: RealtimeDependencies,
): Promise<boolean> {
  if (scope === 'setup') {
    const preparation = await dependencies.prisma.trGamePreparation.findFirst({
      where: {
        setupId: id,
        institutionId: auth.user.institutionId,
        ownerSessionId: auth.session.id,
      },
      select: { id: true },
    });
    return preparation !== null;
  }
  const session = await dependencies.prisma.trGameSession.findFirst({
    where: {
      id,
      institutionId: auth.user.institutionId,
      ownerSessionId: auth.session.id,
    },
    select: { id: true },
  });
  return session !== null;
}
function appConnectionsKey(ownerSessionId: string): string {
  return `arka:app:connections:${ownerSessionId}`;
}

function appMessageRateKey(ownerSessionId: string, nowMs: number): string {
  return `arka:app:rate:${ownerSessionId}:${Math.floor(nowMs / 1_000)}`;
}

export class AppRealtimeGateway {
  readonly server = new WebSocketServer({
    noServer: true,
    maxPayload: APP_MAX_MESSAGE_BYTES,
    perMessageDeflate: false,
  });
  readonly #authorizedUpgrades = new WeakMap<IncomingMessage, AuthorizedUpgrade>();
  readonly #connectionsBySession = new Map<string, Set<AppConnection>>();
  readonly #pendingCleanups = new Set<Promise<void>>();
  constructor(
    private readonly runtime: AuthoritativeRuntime,
    private readonly dependencies: RealtimeDependencies,
  ) {
    this.server.on('connection', (socket, request) => {
      try {
        this.accept(socket, request);
      } catch (error) {
        this.dependencies.logger.warn({ err: error }, 'Koneksi realtime aplikasi gagal');
        socket.close(1011, 'Kesalahan realtime');
      }
    });
  }
  async handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    const auth = await authenticate(request, this.dependencies);
    if (!auth) {
      if (!socket.destroyed)
        socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    const connectionId = randomUUID();
    const now = Date.now();
    const acquired = await this.dependencies.redis.eval(
      ACQUIRE_APP_CONNECTION_SCRIPT,
      1,
      appConnectionsKey(auth.session.id),
      String(now),
      String(APP_MAX_CONNECTIONS_PER_SESSION),
      String(now + APP_CONNECTION_TTL_SECONDS * 1_000),
      connectionId,
      String(APP_CONNECTION_TTL_SECONDS),
    );
    if (Number(acquired) !== 1) {
      if (!socket.destroyed)
        socket.end(
          'HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\nContent-Length: 0\r\n\r\n',
        );
      return;
    }
    this.#authorizedUpgrades.set(request, { auth, connectionId });
    this.server.handleUpgrade(request, socket, head, (webSocket) => {
      this.server.emit('connection', webSocket, request);
    });
  }

  private accept(socket: WebSocket, request: IncomingMessage): void {
    const upgrade = this.#authorizedUpgrades.get(request);
    this.#authorizedUpgrades.delete(request);
    if (!upgrade) {
      sendError(socket, 'unauthorized', 'Sesi masuk tidak valid.');
      socket.close(4401, 'Tidak terautentikasi');
      return;
    }
    const { auth, connectionId } = upgrade;

    const subscriptions = new Map<string, Subscription>();
    let processing = Promise.resolve();
    let outbound = Promise.resolve();
    let closed = false;
    let lastPongAtMs = Date.now();
    let authorizedUntilMs = 0;
    let cleanupPromise: Promise<void> | null = null;

    const leaveSession = async (
      subscription: Subscription,
      removePresence = true,
    ): Promise<void> => {
      subscription.unsubscribe();
      subscriptions.delete(`${subscription.scope}:${subscription.id}`);
      if (removePresence && subscription.scope === 'session') {
        await this.runtime.companionDeparted(subscription.id, auth.session.id, connectionId);
      }
    };

    const stillAuthorized = async (force = false): Promise<boolean> => {
      const now = Date.now();
      if (!force && now < authorizedUntilMs) return true;
      const current = await authenticate(request, this.dependencies);
      const authorized =
        current?.session.id === auth.session.id &&
        current.user.id === auth.user.id &&
        current.user.institutionId === auth.user.institutionId;
      authorizedUntilMs = authorized ? now + AUTHORIZATION_CACHE_MS : 0;
      return authorized;
    };

    const beginClose = (): void => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeatTimer);
      for (const subscription of subscriptions.values()) subscription.unsubscribe();
    };

    const cleanup = (): Promise<void> => {
      beginClose();
      if (cleanupPromise) return cleanupPromise;
      cleanupPromise = Promise.all([processing, outbound])
        .then(async () => {
          const departing = [...subscriptions.values()];
          for (const subscription of departing) subscription.unsubscribe();
          subscriptions.clear();
          const settled = await Promise.allSettled([
            this.dependencies.redis.zrem(appConnectionsKey(auth.session.id), connectionId),
            ...departing
              .filter((subscription) => subscription.scope === 'session')
              .map((subscription) =>
                this.runtime.companionDeparted(subscription.id, auth.session.id, connectionId),
              ),
          ]);
          const failures = settled
            .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
            .map(rejectedReason);
          if (failures.length > 0)
            throw new AggregateError(failures, 'App connection cleanup failed');
        })
        .finally(() => {
          const indexed = this.#connectionsBySession.get(auth.session.id);
          indexed?.delete(connection);
          if (indexed?.size === 0) this.#connectionsBySession.delete(auth.session.id);
        });
      this.#pendingCleanups.add(cleanupPromise);
      void cleanupPromise.then(
        () => this.#pendingCleanups.delete(cleanupPromise!),
        () => this.#pendingCleanups.delete(cleanupPromise!),
      );
      return cleanupPromise;
    };

    const revokeConnection = (): void => {
      if (closed) return;
      sendError(socket, 'unauthorized', 'Sesi masuk sudah berakhir.');
      beginClose();
      socket.terminate();
    };

    const connection: AppConnection = { socket, cleanup };
    const indexed = this.#connectionsBySession.get(auth.session.id) ?? new Set<AppConnection>();
    indexed.add(connection);
    this.#connectionsBySession.set(auth.session.id, indexed);

    const heartbeatTimer = setInterval(() => {
      processing = processing
        .then(async () => {
          if (closed) return;
          if (!(await stillAuthorized(true))) {
            revokeConnection();
            return;
          }
          const now = Date.now();
          if (now - lastPongAtMs > APP_STALE_AFTER_MS) {
            beginClose();
            socket.terminate();
            return;
          }
          if (socket.readyState === WebSocket.OPEN) socket.ping();
        })
        .catch((error) => {
          this.dependencies.logger.warn(
            { err: error, connectionId },
            'Validasi koneksi aplikasi gagal',
          );
          beginClose();
          socket.terminate();
        });
    }, APP_PING_INTERVAL_MS);
    heartbeatTimer.unref();

    socket.on('pong', () => {
      processing = processing
        .then(async () => {
          if (closed) return;
          if (!(await stillAuthorized())) {
            revokeConnection();
            return;
          }
          lastPongAtMs = Date.now();
          await this.dependencies.redis.eval(
            REFRESH_APP_CONNECTION_SCRIPT,
            1,
            appConnectionsKey(auth.session.id),
            connectionId,
            String(lastPongAtMs + APP_CONNECTION_TTL_SECONDS * 1_000),
            String(APP_CONNECTION_TTL_SECONDS),
          );
          for (const subscription of subscriptions.values()) {
            if (closed) return;
            if (subscription.scope === 'session') {
              await this.runtime.companionRefreshed(subscription.id, auth.session.id, connectionId);
            }
          }
        })
        .catch((error: unknown) => {
          this.dependencies.logger.warn(
            { err: error, connectionId },
            'Kehadiran koneksi aplikasi gagal diperbarui',
          );
          beginClose();
          socket.terminate();
        });
    });

    socket.on('close', () => {
      void cleanup().catch((error: unknown) => {
        this.dependencies.logger.warn(
          { err: error, connectionId },
          'Pemutusan aplikasi gagal ditangani',
        );
      });
    });

    socket.on('message', (data, isBinary) => {
      processing = processing
        .then(async () => {
          if (closed) return;
          if (!(await stillAuthorized())) {
            revokeConnection();
            return;
          }
          const rate = await this.dependencies.redis.eval(
            APP_MESSAGE_RATE_SCRIPT,
            1,
            appMessageRateKey(auth.session.id, Date.now()),
          );
          if (Number(rate) > APP_MAX_MESSAGES_PER_SECOND) {
            sendError(socket, 'rate_limited', 'Terlalu banyak pesan realtime.');
            socket.close(4429, 'Terlalu banyak pesan');
            return;
          }
          if (isBinary) {
            sendError(socket, 'invalid_message', 'Pesan biner tidak didukung.');
            socket.close(4400, 'Pesan tidak valid');
            return;
          }
          const encoded = rawDataBuffer(data);
          if (encoded.byteLength > APP_MAX_MESSAGE_BYTES) {
            sendError(socket, 'message_too_large', 'Pesan terlalu besar.');
            socket.close(4400, 'Pesan terlalu besar');
            return;
          }
          let input: unknown;
          try {
            input = JSON.parse(encoded.toString('utf8'));
          } catch {
            sendError(socket, 'malformed_json', 'Format pesan tidak valid.');
            socket.close(4400, 'Pesan tidak valid');
            return;
          }
          const parsed = AppClientMessageSchema.safeParse(input);
          if (!parsed.success) {
            sendError(socket, 'invalid_message', 'Pesan tidak dikenali.');
            socket.close(4400, 'Pesan tidak valid');
            return;
          }

          if (parsed.data.type === 'session.command') {
            const owned = await ownsScope(
              'session',
              parsed.data.payload.sessionId,
              auth,
              this.dependencies,
            );
            if (closed) return;
            if (!owned) {
              sendError(socket, 'forbidden', 'Sesi tidak dapat diakses.');
              socket.close(4403, 'Akses ditolak');
              return;
            }
            await this.runtime.commandSession({
              institutionId: auth.user.institutionId,
              ownerSessionId: auth.session.id,
              userId: auth.user.id,
              requestId: parsed.data.messageId,
              sessionId: parsed.data.payload.sessionId,
              command: parsed.data.payload.command,
            });
            if (closed) return;
            return;
          }

          const scope: Scope = parsed.data.type === 'app.setup.subscribe' ? 'setup' : 'session';
          const id =
            parsed.data.type === 'app.setup.subscribe'
              ? parsed.data.payload.setupId
              : parsed.data.payload.sessionId;
          if (!(await ownsScope(scope, id, auth, this.dependencies))) {
            sendError(socket, 'forbidden', 'Langganan tidak dapat diakses.');
            socket.close(4403, 'Akses ditolak');
            return;
          }
          if (closed) return;

          const key = `${scope}:${id}`;
          const previous = subscriptions.get(key);
          if (previous) {
            await leaveSession(previous, previous.scope !== 'session');
            if (closed) return;
          }
          const subscription: Subscription = {
            scope,
            id,
            lastSequence: parsed.data.payload.cursor ?? 0,
            replaying: true,
            buffered: null,
            pending: null,
            sending: false,
            unsubscribe: () => undefined,
          };
          const flush = (): void => {
            if (subscription.sending || closed) return;
            subscription.sending = true;
            outbound = outbound
              .then(async () => {
                while (subscription.pending && !closed) {
                  const message = subscription.pending;
                  subscription.pending = null;
                  if (message.sequence <= subscription.lastSequence) continue;
                  if (!(await stillAuthorized())) {
                    revokeConnection();
                    return;
                  }
                  subscription.lastSequence = message.sequence;
                  sendValidated(socket, message);
                }
              })
              .catch((error) => {
                this.dependencies.logger.warn(
                  { err: error, connectionId },
                  'Pengiriman realtime aplikasi gagal',
                );
                beginClose();
                socket.terminate();
              })
              .finally(() => {
                subscription.sending = false;
                if (subscription.pending) flush();
              });
          };
          const deliver = (message: AppServerMessage): void => {
            if (message.sequence <= subscription.lastSequence) return;
            if (subscription.replaying) {
              if (!subscription.buffered || message.sequence > subscription.buffered.sequence)
                subscription.buffered = message;
              return;
            }
            if (!subscription.pending || message.sequence > subscription.pending.sequence)
              subscription.pending = message;
            flush();
          };
          subscription.unsubscribe = this.runtime.events.subscribe(scope, id, deliver);
          subscriptions.set(key, subscription);

          const replay = await this.runtime.events.replay(scope, id, subscription.lastSequence);
          if (closed) {
            await leaveSession(subscription, false);
            return;
          }
          const latest = [...replay, ...(subscription.buffered ? [subscription.buffered] : [])]
            .sort((left, right) => right.sequence - left.sequence)[0];
          subscription.buffered = null;
          subscription.replaying = false;
          if (latest) deliver(latest);

          if (scope === 'session') {
            const arrived = await this.runtime.companionArrived(id, auth.session.id, connectionId);
            if (closed) {
              if (arrived) await leaveSession(subscription);
              else await leaveSession(subscription, false);
              return;
            }
            if (!arrived) {
              await leaveSession(subscription);
              sendError(socket, 'session_unavailable', 'Sesi tidak tersedia.');
              socket.close(4404, 'Sesi tidak tersedia');
            }
          }
        })
        .catch((error) => {
          this.dependencies.logger.warn(
            { err: error, messageId: randomUUID() },
            'Pesan realtime aplikasi gagal',
          );
          sendError(socket, 'request_failed', 'Permintaan realtime gagal diproses.');
        });
    });
  }

  async revokeSession(ownerSessionId: string): Promise<void> {
    const connections = [...(this.#connectionsBySession.get(ownerSessionId) ?? [])];
    const cleanups = connections.map((connection) => {
      connection.socket.terminate();
      return connection.cleanup();
    });
    const settled = await Promise.allSettled(cleanups);
    const failures = settled
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map(rejectedReason);
    if (failures.length > 0)
      throw new AggregateError(failures, 'App session socket cleanup failed');
  }

  async close(): Promise<void> {
    const sessions = [...this.#connectionsBySession.keys()];
    const revocations = sessions.map((ownerSessionId) => this.revokeSession(ownerSessionId));
    const serverClosed = new Promise<void>((resolve, reject) => {
      this.server.close((error) => (error ? reject(error) : resolve()));
    });
    const settled = await Promise.allSettled([
      ...revocations,
      ...this.#pendingCleanups,
      serverClosed,
    ]);
    const failures = settled
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map(rejectedReason);
    if (failures.length > 0) throw new AggregateError(failures, 'App gateway cleanup failed');
  }
}
