import type { Duplex } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import { AppRealtimeGateway } from './app-gateway.js';
import { DeviceRealtimeGateway } from './device-gateway.js';
import { AuthoritativeRuntime } from './runtime.js';
import { ParticipantRepository } from '../modules/participant/participant.repository.js';
import { ParticipantService } from '../modules/participant/participant.service.js';
import type { RealtimeDependencies } from './types.js';

export interface RealtimeAttachment {
  readonly runtime: AuthoritativeRuntime;
  readonly appGateway: AppRealtimeGateway;
  readonly deviceGateway: DeviceRealtimeGateway;
  handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): boolean;
  recover(): Promise<void>;
  revokeSession(ownerSessionId: string): Promise<void>;
  close(): Promise<void>;
}

function rejectUpgrade(socket: Duplex, status: number, message: string): void {
  if (!socket.destroyed) {
    socket.end(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  }
}

function participantIdentity(dependencies: RealtimeDependencies): ParticipantService {
  return new ParticipantService(
    new ParticipantRepository(dependencies.prisma),
    dependencies.env.BETTER_AUTH_SECRET,
  );
}

export function createRealtimeAttachment(dependencies: RealtimeDependencies): RealtimeAttachment {
  const runtime = new AuthoritativeRuntime({
    prisma: dependencies.prisma,
    redis: dependencies.redis,
    logger: dependencies.logger,
    env: dependencies.env,
    participantIdentity: participantIdentity(dependencies),
  });
  const appGateway = new AppRealtimeGateway(runtime, dependencies);
  const deviceGateway = new DeviceRealtimeGateway(runtime, dependencies);
  let closed = false;

  return {
    runtime,
    appGateway,
    deviceGateway,
    handleUpgrade(request, socket, head) {
      if (closed || request.method !== 'GET') return false;
      const path = request.url;
      if (path === '/ws/app') {
        const origin = request.headers.origin;
        if (typeof origin !== 'string' || !dependencies.env.browserOrigins.includes(origin)) {
          rejectUpgrade(socket, 403, 'Forbidden');
          return true;
        }
        void appGateway.handleUpgrade(request, socket, head).catch((error) => {
          dependencies.logger.warn({ err: error }, 'Peningkatan realtime aplikasi gagal');
          rejectUpgrade(socket, 500, 'Internal Server Error');
        });
        return true;
      }
      if (path === '/ws/device') {
        deviceGateway.server.handleUpgrade(request, socket, head, (webSocket) => {
          deviceGateway.server.emit('connection', webSocket, request);
        });
        return true;
      }
      return false;
    },
    async recover() {
      if (closed) throw new Error('Realtime attachment sudah ditutup');
      await runtime.recover();
    },
    revokeSession(ownerSessionId) {
      return appGateway.revokeSession(ownerSessionId);
    },
    async close() {
      if (closed) return;
      closed = true;
      await runtime.stop();
      await Promise.all([appGateway.close(), deviceGateway.close()]);
    },
  };
}

export { AppRealtimeGateway } from './app-gateway.js';
export { DeviceRealtimeGateway } from './device-gateway.js';
export { AuthoritativeRuntime } from './runtime.js';
export { RealtimeEventStore } from './events.js';
export type {
  CommandRuntimeSessionInput,
  CreateRuntimeSessionInput,
  OpenPreparationInput,
  RuntimeGateway,
} from './runtime.js';
export type {
  RealtimeAuth,
  RealtimeAuthSession,
  RealtimeDependencies,
  RuntimeDependencies,
} from './types.js';
