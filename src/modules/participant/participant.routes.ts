import { Router } from 'express';
import { asyncHandler, rateLimit, validateBody, validateParams, validateQuery } from '../../middleware/index.js';
import type { RedisClient } from '../../db/index.js';
import type { ParticipantController } from './participant.controller.js';
import {
  CreateParticipantRequestSchema,
  HistoryQuerySchema,
  LeaderboardQuerySchema,
  ParticipantParamsSchema,
  ParticipantSearchQuerySchema,
  ReportQuerySchema,
  ResolveParticipantRequestSchema,
  UpdateParticipantRequestSchema,
} from './participant.validation.js';

export function createParticipantRouter(controller: ParticipantController, redis: RedisClient): Router {
  const router = Router();

  router.get(
    '/participants',
    validateQuery(ParticipantSearchQuerySchema),
    asyncHandler(controller.search),
  );
  router.post(
    '/participants',
    validateBody(CreateParticipantRequestSchema),
    asyncHandler(controller.create),
  );
  router.post(
    '/participants/resolve',
    validateBody(ResolveParticipantRequestSchema),
    asyncHandler(controller.resolve),
  );
  router.get(
    '/participants/:participantId',
    validateParams(ParticipantParamsSchema),
    asyncHandler(controller.get),
  );
  router.get(
    '/participants/:participantId/report',
    validateParams(ParticipantParamsSchema),
    validateQuery(ReportQuerySchema),
    rateLimit(redis, { namespace: 'participant-report', limit: 12, windowSeconds: 60 }),
    asyncHandler(controller.report),
  );
  router.patch(
    '/participants/:participantId',
    validateParams(ParticipantParamsSchema),
    validateBody(UpdateParticipantRequestSchema),
    asyncHandler(controller.update),
  );
  router.get(
    '/participants/:participantId/sessions',
    validateParams(ParticipantParamsSchema),
    validateQuery(HistoryQuerySchema),
    asyncHandler(controller.history),
  );
  router.get(
    '/participants/:participantId/leaderboard',
    validateParams(ParticipantParamsSchema),
    validateQuery(LeaderboardQuerySchema),
    asyncHandler(controller.leaderboard),
  );

  return router;
}
