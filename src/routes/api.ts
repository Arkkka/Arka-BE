import { Router } from 'express';
import type { Env } from '../config/env.js';
import type { RedisClient } from '../db/redis.js';
import type { PrismaClient } from '../generated/prisma/client.js';

import { requireInstitution } from '../middleware/index.js';
import {
  AuthController,
  createAuthRouter,
  DashboardController,
  DashboardRepository,
  DashboardService,
  createDashboardRoutes,
  DeviceController,
  DeviceRepository,
  DeviceService,
  createDeviceRoutes,
  GameController,
  GameRepository,
  GameService,
  createGameRoutes,
  ParticipantController,
  ParticipantRepository,
  ParticipantService,
  createParticipantRouter,
  ProfileController,
  ProfileRepository,
  ProfileService,
  createProfileRoutes,
} from '../modules/index.js';
import type { RuntimeGateway } from '../realtime/index.js';
import { writeAudit } from '../services/audit.js';
import { PdfReportService } from '../services/pdf-report.js';

export interface ApiRouterDependencies {
  readonly prisma: PrismaClient;
  readonly redis: RedisClient;
  readonly env: Env;
  readonly runtime: RuntimeGateway;
}

export function createApiRouter(dependencies: ApiRouterDependencies): Router {
  const router = Router();

  const authController = new AuthController(dependencies.env.BETTER_AUTH_SECRET, dependencies.prisma);
  const participantService = new ParticipantService(
    new ParticipantRepository(dependencies.prisma),
    dependencies.env.BETTER_AUTH_SECRET,
  );
  const gameService = new GameService(
    new GameRepository(dependencies.prisma),
    dependencies.runtime,
    (context, event) => writeAudit(dependencies.prisma, context, event),
  );
  const pdfReportService = new PdfReportService(
    participantService,
    gameService,
    (context, event) => writeAudit(dependencies.prisma, context, event),
  );
  const participantController = new ParticipantController(participantService, pdfReportService);
  const profileController = new ProfileController(
    new ProfileService(new ProfileRepository(dependencies.prisma)),
  );
  const deviceRepository = new DeviceRepository(dependencies.redis);
  const deviceController = new DeviceController(new DeviceService(deviceRepository));
  const dashboardController = new DashboardController(
    new DashboardService(new DashboardRepository(dependencies.prisma, deviceRepository)),
  );
  const gameController = new GameController(gameService, pdfReportService);

  router.use(createAuthRouter(authController));
  router.use(requireInstitution);
  router.use(createProfileRoutes(profileController));
  router.use(createParticipantRouter(participantController, dependencies.redis));
  router.use(createDeviceRoutes(deviceController));
  router.use(createGameRoutes(gameController, dependencies.redis));
  router.use(createDashboardRoutes(dashboardController));
  return router;
}
