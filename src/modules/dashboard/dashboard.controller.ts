import { DashboardLeaderboardQuerySchema } from '../../schemas/index.js';
import type { RequestHandler } from 'express';
import { AppError } from '../../middleware/errors.js';
import type { DashboardService } from './dashboard.service.js';

export class DashboardController {
  constructor(private readonly service: DashboardService) {}

  readonly activity: RequestHandler = async (req, res) => {
    if (!req.authContext)
      throw new AppError(401, 'unauthorized', 'Silakan masuk untuk melanjutkan.');
    res.json(await this.service.activity(req.authContext.institutionId));
  };

  readonly leaderboard: RequestHandler = async (req, res) => {
    if (!req.authContext)
      throw new AppError(401, 'unauthorized', 'Silakan masuk untuk melanjutkan.');
    const query = DashboardLeaderboardQuerySchema.parse(req.query);
    res.set('Cache-Control', 'private, no-store');
    res.json(await this.service.leaderboard(req.authContext.institutionId, query.mode));
  };

  readonly progress: RequestHandler = async (req, res) => {
    if (!req.authContext)
      throw new AppError(401, 'unauthorized', 'Silakan masuk untuk melanjutkan.');
    res.set('Cache-Control', 'private, no-store');
    res.json(await this.service.progress(req.authContext.institutionId));
  };

  readonly summary: RequestHandler = async (req, res) => {
    if (!req.authContext)
      throw new AppError(401, 'unauthorized', 'Silakan masuk untuk melanjutkan.');
    res.json(await this.service.summary(req.authContext.institutionId));
  };
}
