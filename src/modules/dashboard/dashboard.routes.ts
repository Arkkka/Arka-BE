import { DashboardLeaderboardQuerySchema } from '../../schemas/index.js';
import { Router } from 'express';
import { asyncHandler, validateQuery } from '../../middleware/index.js';
import type { DashboardController } from './dashboard.controller.js';

export function createDashboardRoutes(controller: DashboardController): Router {
  const router = Router();
  router.get('/dashboard/summary', asyncHandler(controller.summary));
  router.get('/dashboard/activity', asyncHandler(controller.activity));
  router.get(
    '/dashboard/leaderboard',
    validateQuery(DashboardLeaderboardQuerySchema),
    asyncHandler(controller.leaderboard),
  );
  router.get('/dashboard/progress', asyncHandler(controller.progress));
  return router;
}
