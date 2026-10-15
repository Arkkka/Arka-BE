import type { RequestHandler } from 'express';
import { AppError } from '../../middleware/errors.js';
import type { DeviceService } from './device.service.js';

export class DeviceController {
  constructor(private readonly service: DeviceService) {}

  readonly list: RequestHandler = async (req, res) => {
    if (!req.authContext)
      throw new AppError(401, 'unauthorized', 'Silakan masuk untuk melanjutkan.');
    res.json(await this.service.list(req.authContext.institutionId));
  };
}
