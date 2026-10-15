import { Router } from 'express';
import { asyncHandler, validateBody } from '../../middleware/index.js';
import { UpdateProfileRequestSchema } from '../../schemas/index.js';
import type { ProfileController } from './profile.controller.js';

export function createProfileRoutes(controller: ProfileController): Router {
  const router = Router();
  router.patch(
    '/profile',
    validateBody(UpdateProfileRequestSchema),
    asyncHandler(controller.update),
  );
  return router;
}
