import type { Request, RequestHandler } from 'express';
import { AppError } from '../../middleware/errors.js';
import { UpdateProfileRequestSchema } from '../../schemas/index.js';
import type { ProfileScope, ProfileService } from './profile.service.js';

function profileScope(req: Request): ProfileScope {
  if (!req.authContext) throw new AppError(401, 'unauthorized', 'Silakan masuk untuk melanjutkan.');
  return {
    institutionId: req.authContext.institutionId,
    actorUserId: req.authContext.userId,
    actorSessionId: req.authContext.sessionId,
    requestId: req.requestId,
  };
}

export class ProfileController {
  public constructor(private readonly service: ProfileService) {}

  public readonly update: RequestHandler = async (req, res) => {
    await this.service.update(profileScope(req), UpdateProfileRequestSchema.parse(req.body));
    res.status(204).end();
  };
}
