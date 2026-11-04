import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { z } from 'zod';

loadEnv({ quiet: true });

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  STORAGE_DIR: z.string().default('./storage'),
  MAX_UPLOAD_MB: z.coerce.number().positive().max(200).default(25),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  // AI configuration. The key is never logged or returned by the API.
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().trim().min(1).default('claude-opus-5-5'),
  // auto: API key → Claude Code CLI (your Claude subscription) → `ant auth login` profile.
  AI_PROVIDER: z.enum(['auto', 'anthropic-api', 'claude-code']).default('auto'),
  CLAUDE_CODE_PATH: z.string().trim().min(1).default(process.platform === 'win32' ? 'claude.exe' : 'claude'),
  // Python that runs the QA skill's workbook builder (needs openpyxl). On Windows the `py` launcher.
  PYTHON_PATH: z.string().trim().min(1).default(process.platform === 'win32' ? 'py' : 'python3'),
  AI_EFFORT: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).default('high'),
  // Budget per request. Requests whose input would exceed AI_MAX_INPUT_TOKENS are
  // refused before anything is sent (documents are never silently truncated).
  AI_MAX_INPUT_TOKENS: z.coerce.number().int().min(1000).max(1_000_000).default(300_000),
  AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(1000).max(128_000).default(64_000),
  AI_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  AI_TIMEOUT_SECONDS: z.coerce.number().int().min(30).max(3600).default(900),
});

export type AppConfig = {
  env: 'development' | 'test' | 'production';
  host: string;
  port: number;
  databaseUrl: string;
  storageDir: string; // absolute
  maxUploadBytes: number;
  corsOrigin: string;
  logLevel: string;
  pythonPath: string;
  ai: {
    configured: boolean;
    model: string;
    apiKey?: string;
    provider: 'auto' | 'anthropic-api' | 'claude-code';
    claudeCodePath: string;
    effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
    maxInputTokens: number;
    maxOutputTokens: number;
    maxRetries: number;
    timeoutMs: number;
  };
};

export function loadConfig(overrides: Partial<Record<keyof z.infer<typeof EnvSchema>, string>> = {}): AppConfig {
  const parsed = EnvSchema.safeParse({ ...process.env, ...overrides });
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration (check server/.env):\n${issues}`);
  }
  const e = parsed.data;
  return {
    env: e.NODE_ENV,
    host: e.HOST,
    port: e.PORT,
    databaseUrl: e.DATABASE_URL,
    storageDir: path.resolve(e.STORAGE_DIR),
    maxUploadBytes: Math.round(e.MAX_UPLOAD_MB * 1024 * 1024),
    corsOrigin: e.CORS_ORIGIN,
    logLevel: e.LOG_LEVEL,
    pythonPath: e.PYTHON_PATH,
    ai: {
      configured: Boolean(e.ANTHROPIC_API_KEY && e.ANTHROPIC_API_KEY.trim()),
      model: e.ANTHROPIC_MODEL,
      apiKey: e.ANTHROPIC_API_KEY,
      provider: e.AI_PROVIDER,
      claudeCodePath: e.CLAUDE_CODE_PATH,
      effort: e.AI_EFFORT,
      maxInputTokens: e.AI_MAX_INPUT_TOKENS,
      maxOutputTokens: e.AI_MAX_OUTPUT_TOKENS,
      maxRetries: e.AI_MAX_RETRIES,
      timeoutMs: e.AI_TIMEOUT_SECONDS * 1000,
    },
  };
}
