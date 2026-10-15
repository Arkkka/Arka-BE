import {
  CreateGameSessionRequestSchema,
  CreatePreparationRequestSchema,
  PreparationStatusPatchRequestSchema,
  SessionStatusPatchRequestSchema,
} from '../../schemas/index.js';
import { z } from 'zod';
import { AppError } from '../../middleware/errors.js';

export const PreparationParamsSchema = z.object({ preparationId: z.string().min(20).max(128).regex(/^[A-Za-z0-9_-]+$/u) });
export const SessionParamsSchema = z.object({ sessionId: z.string().uuid() });
export const IdempotencyKeySchema = z
  .string()
  .min(16)
  .max(128)
  .regex(/^[A-Za-z0-9._~-]+$/u);

export function parseIdempotencyKey(value: string | undefined): string {
  const result = IdempotencyKeySchema.safeParse(value);
  if (!result.success) {
    throw new AppError(400, 'idempotency_key_invalid', 'Kunci idempotensi wajib dan tidak valid.');
  }
  return result.data;
}

export {
  CreateGameSessionRequestSchema,
  CreatePreparationRequestSchema,
  PreparationStatusPatchRequestSchema,
  SessionStatusPatchRequestSchema,
};
export type PreparationStatusPatchRequest = z.infer<typeof PreparationStatusPatchRequestSchema>;
export type SessionParams = z.infer<typeof SessionParamsSchema>;
export type CreatePreparationRequest = z.infer<typeof CreatePreparationRequestSchema>;
export type CreateGameSessionRequest = z.infer<typeof CreateGameSessionRequestSchema>;
export type SessionStatusPatchRequest = z.infer<typeof SessionStatusPatchRequestSchema>;
