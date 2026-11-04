// Starts the API for Playwright UI tests against a fresh, isolated database and
// storage folder (.e2e/), so tests never touch your real data in server/prisma/dev.db.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const root = path.resolve(import.meta.dirname, '..');
const server = path.join(root, 'server');
const e2e = path.join(root, '.e2e');
fs.rmSync(e2e, { recursive: true, force: true });
fs.mkdirSync(e2e, { recursive: true });

const env = {
  ...process.env,
  NODE_ENV: 'test',
  DATABASE_URL: `file:${path.join(e2e, 'e2e.db')}`,
  STORAGE_DIR: path.join(e2e, 'storage'),
  PORT: process.env.E2E_API_PORT ?? '4100',
  HOST: '127.0.0.1',
  ANTHROPIC_API_KEY: '',
  AI_PROVIDER: 'anthropic-api',
  // UI tests must see "AI not connected" even if you are signed in with `ant auth login`.
  ANTHROPIC_CONFIG_DIR: path.join(e2e, 'no-anthropic-profile'),
  ANTHROPIC_PROFILE: '',
  ANTHROPIC_AUTH_TOKEN: '',
  MAX_UPLOAD_MB: '5',
};
const require = createRequire(path.join(server, 'package.json'));
const prismaCli = require.resolve('prisma/build/index.js');
const r = spawnSync(process.execPath, [prismaCli, 'migrate', 'deploy'], { cwd: server, env, stdio: 'inherit' });
if (r.status !== 0) process.exit(r.status ?? 1);
const tsx = require.resolve('tsx/cli');
const child = spawn(process.execPath, [tsx, 'src/server.ts'], { cwd: server, env, stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => child.kill(s));
