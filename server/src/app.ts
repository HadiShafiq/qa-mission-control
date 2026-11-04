import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { Prisma, PrismaClient } from '@prisma/client';
import Fastify from 'fastify';
import { SCENARIO_ANALYST, scenarioAnalystHandler } from './agents/scenarioAnalyst.js';
import { TaskRunner } from './agents/runner.js';
import type { AppConfig } from './config.js';
import type { AppContext } from './context.js';
import { createAiClient, type AiClient } from './lib/ai.js';
import { AppError } from './lib/errors.js';
import { Storage } from './lib/storage.js';
import { analysisRoutes } from './routes/analysis.js';
import { artifactRoutes } from './routes/artifacts.js';
import { changeRequestRoutes } from './routes/changeRequests.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { documentRoutes } from './routes/documents.js';
import { projectRoutes } from './routes/projects.js';
import { scenarioRoutes } from './routes/scenarios.js';
import { systemRoutes } from './routes/system.js';

export type BuildOptions = {
  /** Override the AI client (tests inject a double; default comes from config). */
  ai?: AiClient | null;
};

export async function buildApp(config: AppConfig, db = new PrismaClient({ datasourceUrl: config.databaseUrl }), opts: BuildOptions = {}) {
  const app = Fastify({
    logger:
      config.env === 'test'
        ? false
        : {
            level: config.logLevel,
            ...(config.env === 'development'
              ? { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname,reqId' } } }
              : {}),
            // Never log credentials or upload bodies.
            redact: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-api-key"]'],
          },
    bodyLimit: 1024 * 1024,
  });

  const storage = new Storage(config.storageDir);
  await storage.init();
  const ai = opts.ai !== undefined ? opts.ai : await createAiClient(config);
  const runner = new TaskRunner(db, app.log);
  const ctx: AppContext = { db, storage, config, ai, runner };
  runner.register(SCENARIO_ANALYST, scenarioAnalystHandler(ctx));
  app.decorate('qamc', ctx); // server-side only (tests use it to wait for the runner)
  const interrupted = await runner.recover();
  app.log.info(ai ? `AI connected via ${ai.authSource === 'claude-code' ? 'Claude Code CLI (subscription)' : ai.authSource === 'ant-profile' ? 'ant login profile' : 'API key'} (model ${ai.model})` : 'AI not connected');
  if (interrupted) app.log.warn(`${interrupted} agent task(s) were interrupted by the last shutdown and marked failed`);

  await app.register(cors, { origin: config.corsOrigin.split(',').map((s) => s.trim()) });
  await app.register(multipart, { limits: { fileSize: config.maxUploadBytes, files: 20, fields: 10 } });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return reply.code(409).send({ error: { code: 'CONFLICT', message: 'A record with the same unique value already exists' } });
    }
    const e = err as { code?: string; statusCode?: number; message?: string };
    if (e.code === 'FST_REQ_FILE_TOO_LARGE' || e.code === 'FST_FILES_LIMIT') {
      return reply.code(413).send({ error: { code: 'FILE_TOO_LARGE', message: e.message } });
    }
    if (e.statusCode && e.statusCode >= 400 && e.statusCode < 500) {
      return reply.code(e.statusCode).send({ error: { code: e.code ?? 'BAD_REQUEST', message: e.message } });
    }
    req.log.error(err);
    return reply.code(500).send({ error: { code: 'INTERNAL', message: 'Unexpected server error. See server logs for details.' } });
  });

  await app.register(async (api) => {
    await systemRoutes(api, ctx);
    await projectRoutes(api, ctx);
    await changeRequestRoutes(api, ctx);
    await documentRoutes(api, ctx);
    await dashboardRoutes(api, ctx);
    await analysisRoutes(api, ctx);
    await scenarioRoutes(api, ctx);
    await artifactRoutes(api, ctx);
  });

  // In production (`npm start`), serve the built frontend from the same port.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const distDir = path.resolve(here, '../../web/dist');
  const webDist = config.env === 'production' && fs.existsSync(path.join(distDir, 'index.html'));
  if (webDist) await app.register(fastifyStatic, { root: distDir });

  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/') || !webDist) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.url} not found` } });
    }
    return reply.sendFile('index.html'); // SPA fallback for production build
  });

  app.addHook('onClose', async () => {
    await runner.shutdown();
    await db.$disconnect();
  });

  return app;
}
