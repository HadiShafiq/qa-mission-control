import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

// Builds one migrated template database; each test file copies it so tests
// run against a real SQLite database with the real migrations applied.
export default function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qamc-test-'));
  const template = path.join(dir, 'template.db');
  const require = createRequire(import.meta.url);
  const prismaCli = require.resolve('prisma/build/index.js');
  execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: `file:${template}` },
    stdio: 'pipe',
  });
  process.env.QAMC_TEST_TEMPLATE_DB = template;
  process.env.QAMC_TEST_DIR = dir;
  // Never let tests pick up the developer's real `ant auth login` profile or tokens.
  process.env.ANTHROPIC_CONFIG_DIR = path.join(dir, 'no-anthropic-profile');
  delete process.env.ANTHROPIC_PROFILE;
  delete process.env.ANTHROPIC_AUTH_TOKEN;
  return () => fs.rmSync(dir, { recursive: true, force: true });
}
