import { Router } from 'express';
import { asyncHandler, rateLimit, validateBody, validateParams, validateQuery } from '../../middleware/index.js';
import type { RedisClient } from '../../db/index.js';
import { ReportQuerySchema } from '../../schemas/index.js';
import type { GameController } from './game.controller.js';
import {
  CreateGameSessionRequestSchema,
  CreatePreparationRequestSchema,
  PreparationParamsSchema,
  PreparationStatusPatchRequestSchema,
  SessionParamsSchema,
  SessionStatusPatchRequestSchema,
} from './game.validation.js';

export function createGameRoutes(controller: GameController, redis: RedisClient): Router {
  const router = Router();
  router.post(
    '/game-preparations',
    validateBody(CreatePreparationRequestSchema),
    asyncHandler(controller.openPreparation),
  );
  router.patch(
    '/game-preparations/:preparationId/status',
    validateParams(PreparationParamsSchema),
    validateBody(PreparationStatusPatchRequestSchema),
    asyncHandler(controller.commandPreparation),
  );
  router.post(
    '/game-sessions',
    validateBody(CreateGameSessionRequestSchema),
    asyncHandler(controller.createSession),
  );
  router.patch(
    '/game-sessions/:sessionId/status',
    validateParams(SessionParamsSchema),
    validateBody(SessionStatusPatchRequestSchema),
    asyncHandler(controller.commandSession),
  );
  router.get(
    '/game-sessions/:sessionId/report',
    validateParams(SessionParamsSchema),
    validateQuery(ReportQuerySchema),
    rateLimit(redis, { namespace: 'session-report', limit: 12, windowSeconds: 60 }),
    asyncHandler(controller.report),
  );
  router.get(
    '/game-sessions/:sessionId',
    validateParams(SessionParamsSchema),
    asyncHandler(controller.getSession),
  );
  return router;
}
