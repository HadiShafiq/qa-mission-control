import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { buildApp, type BuildOptions } from '../src/app.js';
import { loadConfig } from '../src/config.js';

export async function makeTestApp(overrides: Record<string, string> = {}, opts: BuildOptions = {}) {
  const base = process.env.QAMC_TEST_DIR!;
  const dir = path.join(base, randomUUID());
  fs.mkdirSync(dir);
  const dbFile = path.join(dir, 'test.db');
  fs.copyFileSync(process.env.QAMC_TEST_TEMPLATE_DB!, dbFile);
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: `file:${dbFile}`,
    STORAGE_DIR: path.join(dir, 'storage'),
    ANTHROPIC_API_KEY: '',
    AI_PROVIDER: 'anthropic-api', // never use the developer's Claude Code CLI in tests
    ...overrides,
  });
  const db = new PrismaClient({ datasourceUrl: config.databaseUrl });
  const app = await buildApp(config, db, opts);
  return { app, db, config, dir };
}

/** Build a multipart/form-data body for app.inject(). */
export function multipart(files: { name: string; content: Buffer; field?: string }[]) {
  const boundary = `----qamc${randomUUID()}`;
  const chunks: Buffer[] = [];
  for (const f of files) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${f.field ?? 'files'}"; filename="${f.name}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
      ),
      f.content,
      Buffer.from('\r\n'),
    );
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(chunks), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

export const samplePdf = () => Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
export const sampleZip = () => Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(60, 1)]);
export const samplePng = () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 2)]);
