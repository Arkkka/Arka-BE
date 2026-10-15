import express from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { toNodeHandler } from 'better-auth/node';
import { buildAuthCapabilities, type Auth } from './auth/index.js';
import type { Logger } from './config/logger.js';
import { isRedisConnected } from './db/index.js';
import {
  authenticate,
  errorHandler,
  exactOriginGuard,
  notFoundHandler,
  protectAuthMutation,
  rateLimit,
  requestIdMiddleware,
  requestLogger,
  requireCsrf,
} from './middleware/index.js';
import type { SessionActivityService } from './modules/auth/index.js';
import { createApiRouter, createSwaggerRouter, type ApiRouterDependencies } from './routes/index.js';

export function createApp(dependencies: ApiRouterDependencies & {
  readonly auth: Auth;
  readonly logger: Logger;
  readonly sessionActivity: SessionActivityService;
}) {
  const { auth, env, logger, prisma, redis, sessionActivity } = dependencies;
  const app = express();
  const authHandler = toNodeHandler(auth);

  app.disable('x-powered-by');
  app.use(requestIdMiddleware);
  app.use(
    pinoHttp({
      logger,
      genReqId: (request) =>
        (request as typeof request & { requestId?: string }).requestId ?? 'request-id-unavailable',
      autoLogging: false,
    }),
  );
  app.use(requestLogger);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
          objectSrc: ["'none'"],
          connectSrc: ["'self'"],
        },
      },
    }),
  );
  app.use(exactOriginGuard(env));
  app.use(createSwaggerRouter());

  app.get('/healthz', (_req, res) => res.status(200).json({ status: 'ok' }));
  app.get('/readyz', async (_req, res) => {
    try {
      await prisma.$queryRawUnsafe('SELECT 1');
      if (!isRedisConnected(redis) || (await redis.ping()) !== 'PONG')
        throw new Error('Redis unavailable');
      res.status(200).json({ status: 'ready' });
    } catch {
      res.status(503).json({ status: 'unavailable' });
    }
  });

  app.all(
    '/api/auth/*splat',
    rateLimit(redis, { namespace: 'auth', limit: 20, windowSeconds: 60 }),
    protectAuthMutation(
      auth,
      env.BETTER_AUTH_SECRET,
      sessionActivity.prepareRevocation.bind(sessionActivity),
    ),
    (req, res, next) => void authHandler(req, res).catch(next),
  );

  app.use(express.json({ limit: '64kb', strict: true, type: 'application/json' }));
  app.get('/api/v1/auth/capabilities', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.status(200).json(buildAuthCapabilities(env));
  });
  app.use(
    '/api/v1',
    authenticate(auth, prisma, sessionActivity.validate.bind(sessionActivity)),
    requireCsrf(env.BETTER_AUTH_SECRET),
    rateLimit(redis, { namespace: 'api', limit: 120, windowSeconds: 60 }),
    createApiRouter(dependencies),
  );
  app.use(notFoundHandler);
  app.use(errorHandler(logger));
  return app;
}
