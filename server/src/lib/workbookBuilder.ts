import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Runs the user's own workbook builder from the qa-test-scenario-generator skill
 * (`skills/qa-test-scenario-generator/scripts/build_qa_workbook.py`, unchanged)
 * on a JSON spec, in a temporary folder, and returns the .xlsx bytes plus the
 * builder's audit report. The script only reads the spec and writes the file.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
// Same relative location from src/lib (tsx) and dist/lib (built).
export const SKILL_DIR = path.resolve(here, '..', '..', 'skills', 'qa-test-scenario-generator');
export const BUILDER_SCRIPT = path.join(SKILL_DIR, 'scripts', 'build_qa_workbook.py');

export type BuilderAudit = { result: 'PASS' | 'FAIL'; errors: string[]; warnings: string[]; info: string[]; report: string };
export type BuilderResult = BuilderAudit & { data: Buffer | null };

/** "Python 3.14.7 / openpyxl 3.1.5", or null when Python or openpyxl is missing. */
export function builderAvailable(pythonPath: string): string | null {
  try {
    const r = spawnSync(pythonPath, ['-c', 'import sys, openpyxl; print(sys.version.split()[0], openpyxl.__version__)'], { timeout: 30_000, windowsHide: true, encoding: 'utf8' });
    if (r.status !== 0) return null;
    const [py, ox] = r.stdout.trim().split(/\s+/);
    return `Python ${py} / openpyxl ${ox}`;
  } catch {
    return null;
  }
}

/** Parse the "QA WORKBOOK AUDIT" block the builder prints. */
export function parseAudit(stdout: string): BuilderAudit {
  const lists: Record<string, string[]> = { errors: [], warnings: [], info: [] };
  let current: string | null = null;
  for (const line of stdout.split(/\r?\n/)) {
    if (/^ERRORS \(blocking\):/.test(line)) current = 'errors';
    else if (/^WARNINGS \(review\):/.test(line)) current = 'warnings';
    else if (/^INFO:/.test(line)) current = 'info';
    else if (/^RESULT:/.test(line)) current = null;
    else if (current && line.startsWith('  - ')) lists[current].push(line.slice(4));
  }
  const result = /RESULT:\s*PASS/.test(stdout) ? 'PASS' : 'FAIL';
  return { result, errors: lists.errors, warnings: lists.warnings, info: lists.info, report: stdout.trim() };
}

/**
 * Build the workbook. Without `force` a spec with blocking errors produces no
 * file (data = null), exactly like running the script by hand.
 */
export async function runBuilder(pythonPath: string, spec: unknown, opts: { force?: boolean; timeoutMs?: number } = {}): Promise<BuilderResult> {
  const dir = path.join(os.tmpdir(), `qamc-builder-${randomUUID()}`);
  await fs.mkdir(dir, { recursive: true });
  const specPath = path.join(dir, 'spec.json');
  const outPath = path.join(dir, 'workbook.xlsx');
  await fs.writeFile(specPath, JSON.stringify(spec), 'utf8');
  try {
    const { code, stdout, stderr } = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn(pythonPath, [BUILDER_SCRIPT, specPath, outPath, ...(opts.force ? ['--force'] : [])], {
        cwd: dir,
        windowsHide: true,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
      });
      let out = '';
      let err = '';
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error('The workbook builder did not finish in time.'));
      }, opts.timeoutMs ?? 120_000);
      child.stdout.on('data', (d: Buffer) => (out += d.toString('utf8')));
      child.stderr.on('data', (d: Buffer) => (err += d.toString('utf8')));
      child.on('error', (e: NodeJS.ErrnoException) => {
        clearTimeout(timer);
        reject(new Error(e.code === 'ENOENT' ? `Python was not found ("${pythonPath}"). Install Python with openpyxl, or set PYTHON_PATH in server/.env.` : `Could not start the workbook builder: ${e.message}`));
      });
      child.on('close', (c) => {
        clearTimeout(timer);
        resolve({ code: c, stdout: out, stderr: err });
      });
    });
    if (/openpyxl is required/.test(stdout + stderr)) throw new Error('The workbook builder needs openpyxl: run `py -m pip install openpyxl`.');
    if (!/QA WORKBOOK AUDIT/.test(stdout)) throw new Error(`The workbook builder failed: ${(stderr || stdout).trim().slice(-600)}`);
    const audit = parseAudit(stdout);
    const data = code === 0 ? await fs.readFile(outPath).catch(() => null) : null;
    return { ...audit, data };
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
