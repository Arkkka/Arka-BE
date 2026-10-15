import {
  CreateParticipantRequestSchema,
  HistoryQuerySchema,
  LeaderboardQuerySchema,
  ParticipantSearchQuerySchema,
  ReportQuerySchema,
  ResolveParticipantRequestSchema,
  UpdateParticipantRequestSchema,
} from '../../schemas/index.js';
import { z } from 'zod';

export const ParticipantParamsSchema = z.object({
  participantId: z
    .string()
    .min(20)
    .max(128)
    .regex(/^[A-Za-z0-9_-]+$/u),
});

export {
  CreateParticipantRequestSchema,
  HistoryQuerySchema,
  LeaderboardQuerySchema,
  ParticipantSearchQuerySchema,
  ReportQuerySchema,
  ResolveParticipantRequestSchema,
  UpdateParticipantRequestSchema,
};
