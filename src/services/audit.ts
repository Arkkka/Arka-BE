import type { Prisma, PrismaClient } from '../generated/prisma/client.js';

export interface AuditContext {
  institutionId?: string;
  actorUserId?: string;
  actorSessionId?: string;
  requestId?: string;
}
interface AuditMetadataObject {
  readonly [key: string]: AuditMetadataValue;
}

type AuditMetadataArray = readonly AuditMetadataValue[];
type AuditMetadataValue =
  string | number | boolean | null | AuditMetadataObject | AuditMetadataArray;
type AuditMetadata = Exclude<AuditMetadataValue, null>;

export interface AuditEvent {
  action: string;
  targetType?: string;
  targetId?: string;
  outcome?: string;
  metadata?: AuditMetadata;
}

type AuditDb = Pick<PrismaClient, 'trAuditLog'> | Prisma.TransactionClient;

const SENSITIVE_METADATA_KEY =
  /(?:authorization|cookie|password|secret|token|credential|proof|participantreference|displayname|telemetry|fsrraw|prompt|response)/iu;

function isAuditMetadataArray(value: AuditMetadataValue): value is AuditMetadataArray {
  return Array.isArray(value);
}

function redactAuditValue(value: AuditMetadata): AuditMetadata;
function redactAuditValue(value: AuditMetadataValue): AuditMetadataValue;
function redactAuditValue(value: AuditMetadataValue): AuditMetadataValue {
  if (isAuditMetadataArray(value)) return value.map((item) => redactAuditValue(item));
  if (value === null || typeof value !== 'object') return value;

  const redacted: AuditMetadataObject = Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      SENSITIVE_METADATA_KEY.test(key.replace(/[^a-z]/giu, ''))
        ? '[REDACTED]'
        : redactAuditValue(item),
    ]),
  );
  return redacted;
}

export async function writeAudit(
  db: AuditDb,
  context: AuditContext,
  event: AuditEvent,
): Promise<void> {
  const data: Prisma.TrAuditLogUncheckedCreateInput = {
    action: event.action,
    outcome: event.outcome ?? 'SUCCESS',
    ...(context.institutionId === undefined ? {} : { institutionId: context.institutionId }),
    ...(context.actorUserId === undefined ? {} : { actorUserId: context.actorUserId }),
    ...(context.actorSessionId === undefined ? {} : { actorSessionId: context.actorSessionId }),
    ...(context.requestId === undefined ? {} : { requestId: context.requestId }),
    ...(event.targetType === undefined ? {} : { targetType: event.targetType }),
    ...(event.targetId === undefined ? {} : { targetId: event.targetId }),
    ...(event.metadata === undefined ? {} : { metadata: redactAuditValue(event.metadata) }),
  };
  await db.trAuditLog.create({ data });
}
