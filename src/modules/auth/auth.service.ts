import type { Logger } from '../../config/logger.js';
import type { AuthRepository } from './auth.repository.js';

const SWEEP_INTERVAL_MS = 30_000;

export type RuntimeExpirer = (ownerSessionId: string) => Promise<void>;
export type SocketRevoker = (ownerSessionId: string) => Promise<void>;

export class SessionActivityService {
  #runtimeExpirer: RuntimeExpirer | null = null;
  #socketRevoker: SocketRevoker | null = null;
  #timer: NodeJS.Timeout | null = null;

  public constructor(
    private readonly repository: AuthRepository,
    private readonly logger: Logger,
  ) {}

  public attachRuntimeExpirer(expirer: RuntimeExpirer): void {
    this.#runtimeExpirer = expirer;
  }

  public attachSocketRevoker(revoker: SocketRevoker): void {
    this.#socketRevoker = revoker;
  }

  public async validate(
    ownerSessionId: string,
    userId: string,
    institutionId: string,
  ): Promise<boolean> {
    const session = await this.repository.findActiveSession(ownerSessionId, userId, institutionId);
    if (!session) return false;
    if (session.expiresAt.getTime() > Date.now()) return true;
    void this.expire(ownerSessionId).catch((error: unknown) =>
      this.logger.error(
        { err: error, ownerSessionId },
        'Gagal mengakhiri sesi autentikasi kedaluwarsa',
      ),
    );
    return false;
  }

  public async prepareRevocation(ownerSessionId: string): Promise<void> {
    if (!this.#runtimeExpirer) throw new Error('Runtime session expirer is not attached');
    if (!this.#socketRevoker) throw new Error('App socket revoker is not attached');
    await this.#socketRevoker(ownerSessionId);
    await this.#runtimeExpirer(ownerSessionId);
  }

  public async expire(ownerSessionId: string): Promise<void> {
    if (!this.#runtimeExpirer) return;
    const deleted = await this.repository.deleteExpiredSession(ownerSessionId, new Date());
    if (!deleted) return;
    await this.prepareRevocation(ownerSessionId);
  }

  public start(): void {
    if (this.#timer) return;
    this.#timer = setInterval(() => {
      void this.sweep().catch((error: unknown) =>
        this.logger.error({ err: error }, 'Pemeriksaan kedaluwarsa sesi gagal'),
      );
    }, SWEEP_INTERVAL_MS);
    this.#timer.unref();
  }

  public stop(): void {
    if (!this.#timer) return;
    clearInterval(this.#timer);
    this.#timer = null;
  }

  public async sweep(): Promise<void> {
    const ownerSessionIds = await this.repository.listActiveGameOwnerSessionIds();
    for (const ownerSessionId of ownerSessionIds) {
      const session = await this.repository.findSessionIdentity(ownerSessionId);
      if (!session) {
        if (this.#runtimeExpirer) await this.#runtimeExpirer(ownerSessionId);
        continue;
      }
      await this.validate(ownerSessionId, session.userId, session.institutionId);
    }
  }
}
