const MIN_INSTITUTION_NAME_LENGTH = 2;
const MAX_INSTITUTION_NAME_LENGTH = 120;

export class InstitutionNameError extends Error {
  public constructor() {
    super('institution_name_invalid');
    this.name = 'InstitutionNameError';
  }
}

export function validateRegistrationInstitutionName(value: unknown): string {
  if (typeof value !== 'string') throw new InstitutionNameError();
  const normalized = value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
  if (
    normalized.length < MIN_INSTITUTION_NAME_LENGTH ||
    normalized.length > MAX_INSTITUTION_NAME_LENGTH
  ) {
    throw new InstitutionNameError();
  }
  return normalized;
}
