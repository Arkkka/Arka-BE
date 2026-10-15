import { Router } from 'express';
import { asyncHandler } from '../../middleware/errors.js';
import type { DeviceController } from './device.controller.js';

export function createDeviceRoutes(controller: DeviceController): Router {
  const router = Router();
  router.get('/devices', asyncHandler(controller.list));
  return router;
}
