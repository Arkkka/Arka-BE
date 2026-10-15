import type { PrismaClient } from '../../generated/prisma/client.js';
import type { AuditContext } from '../../services/audit.js';
import { writeAudit } from '../../services/audit.js';

export interface ProfileUpdateData {
  readonly name: string;
  readonly image: string | null;
  readonly institutionName: string;
}

export class ProfileRepository {
  public constructor(private readonly prisma: PrismaClient) {}

  public update(
    context: AuditContext & { readonly institutionId: string; readonly actorUserId: string },
    data: ProfileUpdateData,
  ): Promise<void> {
    return this.prisma.$transaction(async (tx) => {
      await tx.msUser.update({
        where: { id: context.actorUserId, institutionId: context.institutionId },
        data: { name: data.name, image: data.image },
      });
      await tx.msInstitution.update({
        where: { id: context.institutionId },
        data: { name: data.institutionName },
      });
      await writeAudit(tx, context, {
        action: 'PROFILE_UPDATED',
        targetType: 'Institution',
        targetId: context.institutionId,
        metadata: { changedFields: ['name', 'image', 'institutionName'] },
      });
    });
  }
}
