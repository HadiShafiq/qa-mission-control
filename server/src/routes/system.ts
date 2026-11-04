import fs from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { AppError } from '../lib/errors.js';
import { builderAvailable } from '../lib/workbookBuilder.js';

export const APP_VERSION = '0.2.0-phase2';

export async function systemRoutes(app: FastifyInstance, { db, storage, config, ai }: AppContext) {
  const builder = builderAvailable(config.pythonPath);

  app.get('/api/health', async (_req, reply) => {
    const checks = { database: false, storage: false };
    try {
      await db.$queryRaw`SELECT 1`;
      checks.database = true;
    } catch {
      /* reported below */
    }
    try {
      const probe = path.join(storage.root, `.health-${process.pid}`);
      await fs.writeFile(probe, 'ok');
      await fs.rm(probe, { force: true });
      checks.storage = true;
    } catch {
      /* reported below */
    }
    const ok = checks.database && checks.storage;
    reply.code(ok ? 200 : 503);
    return { status: ok ? 'ok' : 'degraded', version: APP_VERSION, checks };
  });

  // Non-secret configuration only. The API key itself is never returned.
  app.get('/api/settings', async () => ({
    version: APP_VERSION,
    environment: config.env,
    database: config.databaseUrl.startsWith('file:') ? 'SQLite' : 'PostgreSQL',
    storageDir: config.storageDir,
    maxUploadMb: Math.round(config.maxUploadBytes / 1024 / 1024),
    workbookBuilder: { available: Boolean(builder), detail: builder ?? `Not available: needs Python with openpyxl (PYTHON_PATH=${config.pythonPath})`, skill: 'qa-test-scenario-generator' },
    ai: {
      provider: 'Anthropic',
      configured: Boolean(ai),
      authSource: ai?.authSource ?? null,
      model: config.ai.model,
      effort: config.ai.effort,
      maxInputTokens: config.ai.maxInputTokens,
      maxOutputTokens: config.ai.maxOutputTokens,
      status: !ai
        ? 'Not connected — run `ant auth login` or set ANTHROPIC_API_KEY in server/.env, then restart the server'
        : `${ai.authSource === 'claude-code' ? 'Using Claude Code on this PC (your Claude subscription, no API credit)' : ai.authSource === 'ant-profile' ? 'Signed in with an ant login profile' : 'API key present'}. Use "Test connection" to check it works.`,
    },
  }));

  // Makes one cheap API call (model lookup) to prove the key and model are valid.
  app.post('/api/settings/ai/test', async () => {
    if (!ai) throw new AppError(409, 'AI_NOT_CONNECTED', 'AI is not connected. Install and sign in to Claude Code, run `ant auth login`, or set ANTHROPIC_API_KEY in server/.env, then restart the server.');
    try {
      const m = await ai.ping();
      return { ok: true, model: m.model, displayName: m.displayName, checkedAt: new Date().toISOString() };
    } catch (err) {
      throw new AppError(502, 'AI_CONNECTION_FAILED', err instanceof Error ? err.message : String(err));
    }
  });
}
