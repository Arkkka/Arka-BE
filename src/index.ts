import { createServer } from 'node:http';
import { createApp } from './app.js';
import { createAuth } from './auth/index.js';
import { env, createLogger } from './config/index.js';
import { connectRedis, createRedis, getPrisma } from './db/index.js';
import { closeHttpServer } from './lifecycle.js';
import { AuthRepository, SessionActivityService } from './modules/auth/index.js';
import { createRealtimeAttachment } from './realtime/index.js';
import { ensureAllInstitutionGameRules } from './game/index.js';
import { createAiSummaryWorker } from './workers/index.js';

const logger = createLogger(env);
const prisma = getPrisma(env);
const redis = createRedis(env, logger);
const auth = createAuth(prisma, env);
const sessionActivity = new SessionActivityService(new AuthRepository(prisma), logger);
const validateSession = sessionActivity.validate.bind(sessionActivity);
const realtime = createRealtimeAttachment({
  prisma,
  redis,
  auth,
  env,
  logger,
  validateSession,
});
const aiSummaryWorker = createAiSummaryWorker({ prisma, env, logger });
const app = createApp({ prisma, redis, auth, env, logger, sessionActivity, runtime: realtime.runtime });
const server = createServer(app);

sessionActivity.attachRuntimeExpirer(realtime.runtime.expireOwnerSession.bind(realtime.runtime));
sessionActivity.attachSocketRevoker(realtime.revokeSession.bind(realtime));

server.on('upgrade', (request, socket, head) => {
  if (!realtime.handleUpgrade(request, socket, head) && !socket.destroyed) {
    socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
  }
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Backend shutdown started');
  sessionActivity.stop();
  const serverClosed = closeHttpServer(server, 10_000);
  await Promise.allSettled([
    serverClosed,
    realtime.close(),
    aiSummaryWorker.stop(),
  ]);
  await Promise.allSettled([redis.quit(), prisma.$disconnect()]);
  logger.info('Backend shutdown completed');
}

async function start(): Promise<void> {
  await connectRedis(redis);
  await prisma.$queryRawUnsafe('SELECT 1');
  await ensureAllInstitutionGameRules(prisma);
  await realtime.recover();
  sessionActivity.start();
  aiSummaryWorker.start();

  const { promise: listening, resolve, reject } = Promise.withResolvers<void>();
  server.once('error', reject);
  server.listen(env.PORT, env.HOST, resolve);
  await listening;
  server.removeListener('error', reject);
  logger.info({ host: env.HOST, port: env.PORT }, 'Backend ready');
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void shutdown(signal).finally(() => process.exit(0));
  });
}

void start().catch(async (error: unknown) => {
  logger.fatal({ err: error }, 'Backend startup failed');
  await shutdown('STARTUP_FAILURE');
  process.exitCode = 1;
});
