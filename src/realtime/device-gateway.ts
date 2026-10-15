import { randomUUID } from 'node:crypto';
import WebSocket, { WebSocketServer, type RawData } from 'ws';
import { issueDeviceChallenge, verifyDeviceProof } from '../device/authentication.js';
import {
  acknowledgeDeviceCommand,
  commandToWire,
  deleteDeviceAssociation,
  listDeviceCommands,
  markDeviceCommandDispatched,
  readDeviceAssociation,
  readDeviceLock,
  releaseDeviceLock,
  updateDeviceAssociationState,
} from '../device/commands.js';
import {
  deviceFamilyForHello,
  redisPrefixForFamily,
  type DeviceFamily,
} from '../device/family.js';
import {
  DEVICE_MAX_MESSAGE_BYTES,
  DEVICE_STALE_AFTER_MS,
  DEVICE_SUBPROTOCOL,
  DeviceAcceptSchema,
  DeviceChallengeSchema,
  DeviceHelloSchema,
  DeviceProveSchema,
  encodeDeviceServerMessage,
  parseDeviceMessage,
  type AuthenticatedDeviceMessage,
  type DeviceClientMessage,
  type DeviceHealthPayload,
  type DeviceHello,
} from '../device/protocol.js';
import {
  isDeviceFirmwareCompatible,
  offlineDeviceReadiness,
  readDeviceReadiness,
  writeDeviceReadiness,
  type DeviceReadiness,
} from '../device/readiness.js';
import { enforceDeviceSequence } from '../device/sequence.js';
import type { AuthoritativeRuntime } from './runtime.js';
import type { RealtimeDependencies } from './types.js';

const CONNECTION_TTL_SECONDS = 15;

function connectionKey(family: DeviceFamily): string {
  return `${redisPrefixForFamily(family)}:connection`;
}
const COMMAND_POLL_MS = 100;
export const DEVICE_READINESS_LOW_BATTERY_PERCENT = 10;
export const DEVICE_INTERRUPT_LOW_BATTERY_PERCENT = 10;
const REFRESH_CONNECTION_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  redis.call('EXPIRE', KEYS[1], ARGV[2])
  return 1
end
return 0
`;
const RELEASE_CONNECTION_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  redis.call('DEL', KEYS[1])
  return 1
end
return 0
`;

interface AuthenticatedConnection {
  readonly socket: WebSocket;
  readonly family: DeviceFamily;
  readonly hello: DeviceHello;
  readonly connectionId: string;
  readonly firmwareCompatible: boolean;
  lastHealthAtMs: number;
  lastHealth: DeviceHealthPayload;
  lastBatteryLogAtMs: number;
  lastLoggedBatteryValid: boolean | null;
  lastLoggedBatteryPercent: number | null;
  lastLoggedBatteryState: 'UNKNOWN' | 'CRITICAL' | 'WARNING' | 'NORMAL' | null;
  dispatching: boolean;
  closed: boolean;
  commandTimer: NodeJS.Timeout;
  staleTimer: NodeJS.Timeout;
}

interface DeviceSocketConnection {
  readonly socket: WebSocket;
  readonly cleanup: (reason: string) => Promise<void>;
}

function rawDataBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data);
}

function send(socket: WebSocket, message: Parameters<typeof encodeDeviceServerMessage>[0]): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(encodeDeviceServerMessage(message));
}

function closeProtocol(socket: WebSocket, reason: string): void {
  if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)
    socket.close(4400, reason.slice(0, 123));
}

function associationFromUnknown(value: unknown): { setupId?: string; sessionId?: string } {
  if (typeof value !== 'object' || value === null) return {};
  const record = value as Record<string, unknown>;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
  if (typeof record['setupId'] === 'string' && uuid.test(record['setupId']))
    return { setupId: record['setupId'] };
  if (typeof record['sessionId'] === 'string' && uuid.test(record['sessionId']))
    return { sessionId: record['sessionId'] };
  return {};
}

export interface DeviceHealthDecision {
  readonly readinessCode: DeviceReadiness['readinessCode'];
  readonly interruptionReason: 'DEVICE_FAULT' | 'DEVICE_LOW_BATTERY' | null;
}

function batteryState(health: DeviceHealthPayload): 'UNKNOWN' | 'CRITICAL' | 'WARNING' | 'NORMAL' {
  if (!health.battery.valid || health.battery.percent === undefined) return 'UNKNOWN';
  if (health.battery.percent <= DEVICE_INTERRUPT_LOW_BATTERY_PERCENT) return 'CRITICAL';
  if (health.battery.percent <= 20) return 'WARNING';
  return 'NORMAL';
}

function shouldLogBattery(connection: AuthenticatedConnection, health: DeviceHealthPayload, nowMs: number): boolean {
  const percent = health.battery.valid ? (health.battery.percent ?? null) : null;
  const state = batteryState(health);
  return connection.lastLoggedBatteryValid !== health.battery.valid ||
    connection.lastLoggedBatteryState !== state ||
    (percent !== null && connection.lastLoggedBatteryPercent !== null && Math.abs(percent - connection.lastLoggedBatteryPercent) >= 5) ||
    nowMs - connection.lastBatteryLogAtMs >= 60_000;
}

export function decideDeviceHealth(
  health: DeviceHealthPayload,
  lockState: 'HELD' | 'RELEASING' | null,
  firmwareCompatible: boolean,
): DeviceHealthDecision {
  const batteryPercent = health.battery.valid ? (health.battery.percent ?? null) : null;
  const readinessCode = !firmwareCompatible
    ? 'NOT_COMPATIBLE'
    : health.faults.length > 0
      ? 'DEVICE_FAULT'
      : batteryPercent !== null && batteryPercent <= DEVICE_READINESS_LOW_BATTERY_PERCENT
        ? 'NOT_READY_LOW_BATTERY'
        : lockState === 'RELEASING'
          ? 'CLEANUP_PENDING'
          : lockState === 'HELD'
              ? 'RESERVED'
              : 'READY';
  const interruptionReason =
    health.faults.length > 0
      ? 'DEVICE_FAULT'
      : batteryPercent !== null && batteryPercent <= DEVICE_INTERRUPT_LOW_BATTERY_PERCENT
        ? 'DEVICE_LOW_BATTERY'
        : null;
  return { readinessCode, interruptionReason };
}

export class DeviceRealtimeGateway {
  readonly server = new WebSocketServer({
    noServer: true,
    maxPayload: DEVICE_MAX_MESSAGE_BYTES,
    perMessageDeflate: false,
    handleProtocols: (protocols) => (protocols.has(DEVICE_SUBPROTOCOL) ? DEVICE_SUBPROTOCOL : false),
  });
  readonly #connections = new Set<DeviceSocketConnection>();
  readonly #pendingCleanups = new Set<Promise<void>>();

  constructor(
    private readonly runtime: AuthoritativeRuntime,
    private readonly dependencies: RealtimeDependencies,
  ) {
    this.server.on('connection', (socket) => this.accept(socket));
  }

  private trackCleanup(cleanup: Promise<void>): Promise<void> {
    this.#pendingCleanups.add(cleanup);
    void cleanup.finally(() => this.#pendingCleanups.delete(cleanup));
    return cleanup;
  }

  private accept(socket: WebSocket): void {
    let hello: DeviceHello | null = null;
    let family: DeviceFamily | null = null;
    let connection: AuthenticatedConnection | null = null;
    let processing = Promise.resolve();
    let sequenceInitialized = false;
    let lastAcceptedSequence: number | null = null;
    let associationRevision = 0;
    let pendingTelemetry: (() => Promise<void>) | null = null;
    let telemetryProcessing = false;
    let closing = false;
    let cleanupPromise: Promise<void> | null = null;

    const scheduleTelemetry = (task: () => Promise<void>): void => {
      pendingTelemetry = task;
      if (telemetryProcessing) return;
      telemetryProcessing = true;
      void (async () => {
        while (!closing && pendingTelemetry) {
          const next = pendingTelemetry;
          pendingTelemetry = null;
          try {
            await next();
          } catch (error) {
            this.dependencies.logger.warn({ err: error }, 'Telemetri perangkat gagal diproses');
          }
        }
      })().finally(() => {
        telemetryProcessing = false;
        if (!closing && pendingTelemetry) {
          const next = pendingTelemetry;
          pendingTelemetry = null;
          scheduleTelemetry(next);
        }
      });
    };

    const beginClose = (): void => {
      if (closing) return;
      closing = true;
      if (connection) {
        clearInterval(connection.commandTimer);
        clearInterval(connection.staleTimer);
      }
    };

    const cleanup = (reason: string): Promise<void> => {
      beginClose();
      if (cleanupPromise) return cleanupPromise;
      cleanupPromise = (async () => {
        if (!connection || connection.closed) return;
        connection.closed = true;
        this.dependencies.logger.info(
          { connectionId: connection.connectionId, cleanupReason: reason },
          'Koneksi perangkat dibersihkan',
        );
        const released = await this.dependencies.redis.eval(
          RELEASE_CONNECTION_SCRIPT,
          1,
          connectionKey(connection.family),
          connection.connectionId,
        );
        if (Number(released) !== 1) return;
        await writeDeviceReadiness(
          this.dependencies.redis,
          connection.family,
          offlineDeviceReadiness(),
        );
        await this.runtime.interruptDeviceFamily(connection.family, reason);
      })().finally(() => this.#connections.delete(socketConnection));
      return this.trackCleanup(cleanupPromise);
    };
    const socketConnection: DeviceSocketConnection = { socket, cleanup };
    this.#connections.add(socketConnection);

    const disconnected = (): void => {
      void cleanup('DEVICE_DISCONNECTED').catch((error) =>
        this.dependencies.logger.warn({ err: error }, 'Pemutusan perangkat gagal ditangani'),
      );
    };
    socket.on('close', (code, reason) => {
      this.dependencies.logger.info(
        { code, reason: reason.toString('utf8'), connectionId: connection?.connectionId ?? null },
        'Koneksi perangkat ditutup',
      );
      disconnected();
    });
    socket.on('error', (error) => {
      this.dependencies.logger.warn(
        { err: error, connectionId: connection?.connectionId ?? null },
        'Koneksi perangkat mengalami error',
      );
      disconnected();
      socket.terminate();
    });

    socket.on('message', (data, isBinary) => {
      if (closing) return;
      const receivedAtMs = Date.now();
      const processMessage = async (): Promise<void> => {
          if (closing) return;
          if (isBinary) {
            await cleanup('MALFORMED_DEVICE_INPUT');
            closeProtocol(socket, 'Pesan biner tidak didukung');
            return;
          }
          const encoded = rawDataBuffer(data);
          let parsedUnknown: unknown;
          try {
            parsedUnknown = JSON.parse(encoded.toString('utf8'));
          } catch {
            await cleanup('MALFORMED_DEVICE_INPUT');
            closeProtocol(socket, 'Format pesan tidak valid');
            return;
          }
          let message: DeviceClientMessage;
          try {
            message = parseDeviceMessage(encoded);
          } catch {
            if (connection)
              await this.runtime.interruptAssociation(
                connection.family,
                associationFromUnknown(parsedUnknown),
                'MALFORMED_DEVICE_INPUT',
              );
            await cleanup('MALFORMED_DEVICE_INPUT');
            closeProtocol(socket, 'Pesan tidak valid');
            return;
          }

          if (!hello) {
            const parsedHello = DeviceHelloSchema.safeParse(message);
            if (!parsedHello.success) {
              closeProtocol(socket, 'Identitas perangkat ditolak');
              return;
            }
            hello = parsedHello.data;
            family = deviceFamilyForHello(hello);
            if (!family) {
              closeProtocol(socket, 'Kapabilitas perangkat ditolak');
              return;
            }
            if (!this.dependencies.env.DEVICE_SECRET_BASE64) {
              closeProtocol(socket, 'Identitas perangkat ditolak');
              return;
            }
            const challenge = await issueDeviceChallenge(this.dependencies.redis, family, hello);
            send(
              socket,
              DeviceChallengeSchema.parse({
                protocolVersion: 1,
                type: 'device.challenge',
                messageId: randomUUID(),
                sentAtMs: Date.now(),
                sequence: 0,
                payload: challenge,
              }),
            );
            return;
          }

          if (!connection) {
            const prove = DeviceProveSchema.safeParse(message);
            const secret = this.dependencies.env.DEVICE_SECRET_BASE64;
            if (
              !prove.success ||
              !secret ||
              !family ||
              !(await verifyDeviceProof(this.dependencies.redis, family, prove.data, hello, secret))
            ) {
              closeProtocol(socket, 'Bukti perangkat ditolak');
              return;
            }
            const connectionId = randomUUID();
            const acquired = await this.dependencies.redis.set(
              connectionKey(family),
              connectionId,
              'EX',
              CONNECTION_TTL_SECONDS,
              'NX',
            );
            if (acquired !== 'OK') {
              const readiness = await readDeviceReadiness(this.dependencies.redis, family);
              this.dependencies.logger.info(
                { activeConnectionId: readiness.connectionId, lastSeenAt: readiness.lastSeenAt },
                'Proof perangkat ditolak karena koneksi aktif',
              );
              closeProtocol(socket, 'Perangkat sudah terhubung');
              return;
            }
            const now = Date.now();
            connection = {
              socket,
              family,
              hello,
              connectionId,
              firmwareCompatible: isDeviceFirmwareCompatible(hello.payload.firmwareVersion),
              lastHealthAtMs: now,
              lastHealth: { battery: { valid: false }, faults: [] },
              lastBatteryLogAtMs: 0,
              lastLoggedBatteryValid: null,
              lastLoggedBatteryPercent: null,
              lastLoggedBatteryState: null,
              dispatching: false,
              closed: false,
              commandTimer: setInterval(() => {
                if (connection)
                  void this.dispatchCommands(connection).catch((error) =>
                    this.dependencies.logger.warn({ err: error }, 'Pengiriman perintah gagal'),
                  );
              }, COMMAND_POLL_MS),
              staleTimer: setInterval(() => {
                if (connection && Date.now() - connection.lastHealthAtMs > DEVICE_STALE_AFTER_MS)
                  void cleanup('DEVICE_HEARTBEAT_TIMEOUT').finally(() => socket.terminate());
              }, 1_000),
            };
            connection.commandTimer.unref();
            connection.staleTimer.unref();
            await writeDeviceReadiness(this.dependencies.redis, family, {
              connectionStatus: connection.firmwareCompatible ? 'ONLINE' : 'CONNECTING',
              readinessCode: connection.firmwareCompatible
                ? 'NOT_READY_BATTERY_UNKNOWN'
                : 'NOT_COMPATIBLE',
              firmwareVersion: hello.payload.firmwareVersion,
              capabilities: hello.payload.capabilities,
              batteryPercent: null,
              lastSeenAt: new Date(now).toISOString(),
              connectionId,
              bootId: hello.bootId,
            });
            send(
              socket,
              DeviceAcceptSchema.parse({
                protocolVersion: 1,
                type: 'device.accept',
                messageId: randomUUID(),
                sentAtMs: now,
                sequence: 0,
                payload: { connectionId, heartbeatIntervalMs: 5_000, maxSequenceGap: 32 },
              }),
            );
            await this.dispatchCommands(connection).catch((error) =>
              this.dependencies.logger.warn(
                { err: error, connectionId: connection?.connectionId ?? null },
                'Pengiriman perintah awal gagal',
              ),
            );
            return;
          }

          if (message.type === 'device.hello' || message.type === 'device.prove') {
            await cleanup('UNEXPECTED_HANDSHAKE_MESSAGE');
            closeProtocol(socket, 'Pesan handshake tidak diharapkan');
            return;
          }
          const authenticated = message;
          const decision = await enforceDeviceSequence(
            this.dependencies.redis,
            connection.family,
            connection.hello.bootId,
            authenticated,
            receivedAtMs,
            !sequenceInitialized &&
              (authenticated.type === 'device.status' || authenticated.type === 'device.heartbeat'),
          );
          if (decision === 'ACCEPT' || decision === 'TELEMETRY_DROPPED') {
            sequenceInitialized = true;
            lastAcceptedSequence = authenticated.sequence;
          }
          if (decision === 'DUPLICATE' || decision === 'TELEMETRY_DROPPED') return;
          if (decision !== 'ACCEPT') {
            this.dependencies.logger.warn(
              {
                connectionId: connection.connectionId,
                deviceFamily: connection.family,
                terminalReason: `DEVICE_SEQUENCE_${decision}`,
                messageType: authenticated.type,
                receivedSequence: authenticated.sequence,
                lastAcceptedSequence,
                expectedNextSequence: lastAcceptedSequence === null ? null : lastAcceptedSequence + 1,
                sequenceGap: lastAcceptedSequence === null ? null : authenticated.sequence - lastAcceptedSequence,
                suggestedAction: 'Periksa urutan pengiriman pesan perangkat dan log koneksi sebelumnya; urutan terakhir hanya mencakup koneksi ini.',
              },
              decision === 'GAP'
                ? 'Pesan ditolak karena loncatan nomor urut melebihi batas yang diizinkan'
                : decision === 'STALE'
                  ? 'Pesan ditolak karena nomor urut sudah tertinggal atau pernah diproses'
                  : 'Pesan ditolak karena laju pengiriman melebihi batas',
            );
            await this.runtime.interruptAssociation(
              connection.family,
              associationFromUnknown(authenticated),
              `DEVICE_SEQUENCE_${decision}`,
            );
            await cleanup(`DEVICE_SEQUENCE_${decision}`);
            closeProtocol(socket, 'Urutan pesan ditolak');
            return;
          }
          const renewed = await this.dependencies.redis.eval(
            REFRESH_CONNECTION_SCRIPT,
            1,
            connectionKey(connection.family),
            connection.connectionId,
            String(CONNECTION_TTL_SECONDS),
          );
          if (Number(renewed) !== 1) {
            this.dependencies.logger.warn(
              { connectionId: connection.connectionId },
              'Lease koneksi perangkat hilang',
            );
            await cleanup('DEVICE_CONNECTION_LEASE_LOST');
            socket.terminate();
            return;
          }

          if (authenticated.type === 'device.heartbeat' || authenticated.type === 'device.status') {
            const healthReceivedAtMs = Date.now();
            connection.lastHealthAtMs = healthReceivedAtMs;
            connection.lastHealth = authenticated.payload;
            if (shouldLogBattery(connection, authenticated.payload, healthReceivedAtMs)) {
              const percent = authenticated.payload.battery.valid ? (authenticated.payload.battery.percent ?? null) : null;
              const state = batteryState(authenticated.payload);
              this.dependencies.logger.info(
                {
                  connectionId: connection.connectionId,
                  deviceFamily: connection.family,
                  batteryValid: authenticated.payload.battery.valid,
                  batteryPercent: percent,
                  batteryState: state,
                  healthMessageType: authenticated.type,
                },
                'Status baterai perangkat diterima',
              );
              connection.lastBatteryLogAtMs = healthReceivedAtMs;
              connection.lastLoggedBatteryValid = authenticated.payload.battery.valid;
              connection.lastLoggedBatteryPercent = percent;
              connection.lastLoggedBatteryState = state;
            }
            await this.updateReadiness(connection);
            return;
          }
          if (authenticated.type === 'device.commandAck') {
            associationRevision += 1;
            await this.handleAcknowledgement(connection, authenticated, receivedAtMs);
            return;
          }
          const inputConnection = connection;
          const inputRevision = associationRevision;
          const processInput = async (): Promise<void> => {
            if (closing || inputRevision !== associationRevision) return;
            const association =
              'setupId' in authenticated
                ? { type: 'SETUP' as const, id: authenticated.setupId }
                : { type: 'SESSION' as const, id: authenticated.sessionId };
            const associationDecision = await this.associationDecision(
              inputConnection.family,
              association.type,
              association.id,
            );
            if (closing || inputRevision !== associationRevision || associationDecision === 'DROP') return;
            if (associationDecision === 'REJECT') {
              await this.runtime.interruptAssociation(
                inputConnection.family,
                association.type === 'SETUP'
                  ? { setupId: association.id }
                  : { sessionId: association.id },
                'INVALID_DEVICE_ASSOCIATION',
              );
              await cleanup('INVALID_DEVICE_ASSOCIATION');
              closeProtocol(socket, 'Asosiasi perangkat ditolak');
              return;
            }
            const trustedInput = {
              receivedAtMs,
              connectionId: inputConnection.connectionId,
              bootId: inputConnection.hello.bootId,
              messageId: authenticated.messageId,
              sequence: authenticated.sequence,
              sentAtMs: authenticated.sentAtMs,
            };
            const target =
              association.type === 'SETUP'
                ? { setupId: association.id }
                : { sessionId: association.id };
            if (authenticated.type === 'telemetry.fsr') {
              await this.runtime.handleFsr(
                inputConnection.family,
                target,
                authenticated.payload.fsrRaw,
                trustedInput,
              );
            } else
              await this.runtime.handleButton(
                inputConnection.family,
                target,
                authenticated.payload.buttonCode,
                trustedInput,
              );
          };
          if (authenticated.type === 'telemetry.fsr') scheduleTelemetry(processInput);
          else await processInput();
      };
      const handleError = (error: unknown): void => {
        this.dependencies.logger.warn({ err: error }, 'Pesan perangkat gagal diproses');
      };
      processing = processing.then(processMessage).catch(handleError);
    });
  }

  private async associationDecision(
    family: DeviceFamily,
    type: 'SETUP' | 'SESSION',
    id: string,
  ): Promise<'ALLOW' | 'DROP' | 'REJECT'> {
    const [association, lock] = await Promise.all([
      readDeviceAssociation(this.dependencies.redis, family, type, id),
      readDeviceLock(this.dependencies.redis, family),
    ]);
    if (association?.state === 'BOUND' && association.lockId === lock?.lockId) return 'ALLOW';
    if (
      (association?.state === 'BINDING' || association?.state === 'UNBINDING') &&
      association.lockId === lock?.lockId
    )
      return 'DROP';
    if (
      type === 'SETUP' &&
      lock?.holderType === 'SESSION' &&
      lock.setupId === id &&
      (!association ||
        (association.lockId === lock.lockId && association.state === 'UNBINDING'))
    )
      return 'DROP';
    return 'REJECT';
  }

  private async updateReadiness(connection: AuthenticatedConnection): Promise<void> {
    const lock = await readDeviceLock(this.dependencies.redis, connection.family);
    const health = connection.lastHealth;
    const batteryPercent = health.battery.valid ? (health.battery.percent ?? null) : null;
    const decision = decideDeviceHealth(
      health,
      lock?.state ?? null,
      connection.firmwareCompatible,
    );
    await writeDeviceReadiness(this.dependencies.redis, connection.family, {
      connectionStatus: connection.firmwareCompatible ? 'ONLINE' : 'CONNECTING',
      readinessCode: decision.readinessCode,
      firmwareVersion: connection.hello.payload.firmwareVersion,
      capabilities: connection.hello.payload.capabilities,
      batteryPercent,
      lastSeenAt: new Date().toISOString(),
      connectionId: connection.connectionId,
      bootId: connection.hello.bootId,
    });
    this.dependencies.logger.info(
      {
        connectionId: connection.connectionId,
        firmwareVersion: connection.hello.payload.firmwareVersion,
        readinessCode: decision.readinessCode,
      },
      'Status kesiapan perangkat diperbarui',
    );
    if (decision.interruptionReason) {
      this.dependencies.logger.warn(
        {
          connectionId: connection.connectionId,
          deviceFamily: connection.family,
          terminalReason: decision.interruptionReason,
          batteryValid: health.battery.valid,
          batteryPercent,
          batteryState: batteryState(health),
          thresholdPercent: DEVICE_INTERRUPT_LOW_BATTERY_PERCENT,
          readinessCode: decision.readinessCode,
          firmwareCompatible: connection.firmwareCompatible,
          faultCount: health.faults.length,
          lockState: lock?.state ?? null,
          suggestedAction: decision.interruptionReason === 'DEVICE_LOW_BATTERY'
            ? 'Isi daya perangkat hingga baterai di atas batas minimum, lalu ulangi pairing.'
            : 'Periksa status fault pada perangkat sebelum mengulang pairing.',
        },
        decision.interruptionReason === 'DEVICE_LOW_BATTERY'
          ? 'Perangkat tidak aman untuk sesi: baterai valid berada pada atau di bawah batas minimum'
          : 'Perangkat melaporkan fault; sesi terkait akan dihentikan demi keamanan',
      );
      await this.runtime.interruptDeviceFamily(connection.family, decision.interruptionReason);
    }
  }

  private async handleAcknowledgement(
    connection: AuthenticatedConnection,
    message: Extract<AuthenticatedDeviceMessage, { type: 'device.commandAck' }>,
    receivedAtMs: number,
  ): Promise<void> {
    const associationId = 'setupId' in message ? message.setupId : message.sessionId;
    const associationType = 'setupId' in message ? 'SETUP' : 'SESSION';
    const acknowledged = await acknowledgeDeviceCommand(
      this.dependencies.redis,
      connection.family,
      {
      commandId: message.payload.commandId,
      associationId,
      associationType,
      connectionId: connection.connectionId,
      bootId: connection.hello.bootId,
      outcome: message.payload.outcome,
      receivedAtMs,
      ...(message.payload.reason ? { reason: message.payload.reason } : {}),
      ...(message.payload.outcome === 'ACK' && associationType === 'SETUP'
        ? {
            beforeComplete: async (command) => {
              if (command.kind === 'SETUP_UNBIND')
                await this.runtime.handleSetupUnbound(
                  connection.family,
                  associationId,
                  command.commandId,
                );
            },
          }
        : {}),
    });
    if (!acknowledged) {
      await this.runtime.interruptAssociation(
        connection.family,
        associationFromUnknown(message),
        'INVALID_COMMAND_ACK',
      );
      throw new Error('ACK perangkat tidak sesuai perintah aktif');
    }
    if (acknowledged.duplicate) return;
    const command = acknowledged.command;
    if (message.payload.outcome === 'NACK') {
      await this.runtime.interruptAssociation(
        connection.family,
        associationFromUnknown(message),
        `DEVICE_COMMAND_NACK_${message.payload.reason}`,
      );
      return;
    }
    if (command.kind === 'SETUP_BIND' && 'setupId' in message) {
      const updated = await updateDeviceAssociationState(
        this.dependencies.redis,
        connection.family,
        'SETUP',
        message.setupId,
        command.lockId,
        'BOUND',
      );
      if (!updated) throw new Error('Asosiasi setup perangkat sudah berubah');
      await this.runtime.handleSetupBound(connection.family, message.setupId);
    } else if (command.kind === 'SETUP_UNBIND' && 'setupId' in message) {
      await deleteDeviceAssociation(this.dependencies.redis, connection.family, 'SETUP', message.setupId);
    } else if (command.kind === 'SESSION_BIND' && 'sessionId' in message) {
      const updated = await updateDeviceAssociationState(
        this.dependencies.redis,
        connection.family,
        'SESSION',
        message.sessionId,
        command.lockId,
        'BOUND',
      );
      if (!updated) throw new Error('Asosiasi sesi perangkat sudah berubah');
      await this.runtime.handleSessionBound(connection.family, message.sessionId);
    } else if (command.kind === 'SESSION_UNBIND' && 'sessionId' in message) {
      await deleteDeviceAssociation(this.dependencies.redis, connection.family, 'SESSION', message.sessionId);
      await releaseDeviceLock(this.dependencies.redis, connection.family, command.lockId);
      await this.updateReadiness(connection);
    }
  }

  private async dispatchCommands(connection: AuthenticatedConnection): Promise<void> {
    if (
      connection.closed ||
      connection.dispatching ||
      connection.socket.readyState !== WebSocket.OPEN
    )
      return;
    connection.dispatching = true;
    try {
      const lock = await readDeviceLock(this.dependencies.redis, connection.family);
      for (const command of await listDeviceCommands(this.dependencies.redis, connection.family)) {
        if (!lock || command.lockId !== lock.lockId) continue;
        const claimed = await markDeviceCommandDispatched(
          this.dependencies.redis,
          connection.family,
          command,
          connection.connectionId,
          connection.hello.bootId,
        );
        if (claimed) send(connection.socket, commandToWire(claimed));
      }
    } finally {
      connection.dispatching = false;
    }
  }

  async close(): Promise<void> {
    const cleanups = [...this.#connections].map((connection) => {
      const cleanup = connection.cleanup('DEVICE_DISCONNECTED');
      connection.socket.terminate();
      return cleanup;
    });
    const serverClosed = new Promise<void>((resolve, reject) =>
      this.server.close((error) => (error ? reject(error) : resolve())),
    );
    const settled = await Promise.allSettled([...cleanups, ...this.#pendingCleanups, serverClosed]);
    const failures = settled
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map((result) => result.reason as unknown);
    if (failures.length > 0) throw new AggregateError(failures, 'Device gateway cleanup failed');
  }
}
