import type { PrismaClient } from '../../generated/prisma/client.js';

export interface SessionExpiryRecord {
  readonly expiresAt: Date;
}

export interface SessionIdentityRecord {
  readonly userId: string;
  readonly institutionId: string;
}

export class AuthRepository {
  public constructor(private readonly prisma: PrismaClient) {}

  public async findActiveSession(
    ownerSessionId: string,
    userId: string,
    institutionId: string,
  ): Promise<SessionExpiryRecord | null> {
    return this.prisma.trSession.findFirst({
      where: {
        id: ownerSessionId,
        userId,
        user: { institutionId, institution: { status: 'ACTIVE' } },
      },
      select: { expiresAt: true },
    });
  }

  public async findSessionIdentity(ownerSessionId: string): Promise<SessionIdentityRecord | null> {
    const session = await this.prisma.trSession.findUnique({
      where: { id: ownerSessionId },
      select: { userId: true, user: { select: { institutionId: true } } },
    });
    if (!session?.user.institutionId) return null;
    return { userId: session.userId, institutionId: session.user.institutionId };
  }

  public async listActiveGameOwnerSessionIds(): Promise<readonly string[]> {
    const sessions = await this.prisma.trGameSession.findMany({
      where: { status: { in: ['BINDING', 'COUNTDOWN', 'PLAYING', 'PAUSED'] } },
      select: { ownerSessionId: true },
      distinct: ['ownerSessionId'],
    });
    return sessions.map(({ ownerSessionId }) => ownerSessionId);
  }


  public async deleteExpiredSession(ownerSessionId: string, now: Date): Promise<boolean> {
    const deleted = await this.prisma.trSession.deleteMany({
      where: { id: ownerSessionId, expiresAt: { lte: now } },
    });
    return deleted.count === 1;
  }
}
