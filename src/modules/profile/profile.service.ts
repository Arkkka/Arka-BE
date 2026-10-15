import { validateRegistrationInstitutionName } from '../../auth/institution-provisioning.js';
import { UpdateProfileRequestSchema, type UpdateProfileRequest } from '../../schemas/index.js';
import type { AuditContext } from '../../services/audit.js';
import type { ProfileRepository } from './profile.repository.js';

export interface ProfileScope extends AuditContext {
  readonly institutionId: string;
  readonly actorUserId: string;
}

export class ProfileService {
  public constructor(private readonly repository: ProfileRepository) {}

  public async update(scope: ProfileScope, input: UpdateProfileRequest): Promise<void> {
    const parsed = UpdateProfileRequestSchema.parse(input);
    await this.repository.update(scope, {
      name: parsed.name.normalize('NFKC').trim().replace(/\s+/gu, ' '),
      image: parsed.image,
      institutionName: validateRegistrationInstitutionName(parsed.institutionName),
    });
  }
}
