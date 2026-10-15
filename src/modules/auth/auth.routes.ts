import { Router } from 'express';
import { asyncHandler } from '../../middleware/index.js';
import type { AuthController } from './auth.controller.js';

export function createAuthRouter(controller: AuthController): Router {
  const router = Router();
  router.get('/me', asyncHandler(controller.me));
  router.get('/auth/onboarding', asyncHandler(controller.onboardingStatus));
  router.post('/auth/onboarding', asyncHandler(controller.completeOnboarding));
  return router;
}
