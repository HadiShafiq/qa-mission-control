import type { PrismaClient } from '@prisma/client';
import type { TaskRunner } from './agents/runner.js';
import type { AppConfig } from './config.js';
import type { AiClient } from './lib/ai.js';
import type { Storage } from './lib/storage.js';

export type AppContext = {
  db: PrismaClient;
  storage: Storage;
  config: AppConfig;
  /** null when ANTHROPIC_API_KEY is not set: AI features report "not connected". */
  ai: AiClient | null;
  runner: TaskRunner;
};
