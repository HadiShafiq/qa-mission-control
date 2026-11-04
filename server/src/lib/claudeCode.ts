import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import type { AppConfig } from '../config.js';
import { AiError, parseStructured, type AiClient, type AiContent, type StructuredRequest, type StructuredResult } from './ai.js';

/**
 * AI engine that runs the Claude Code CLI installed on this PC (`claude -p`),
 * so requests use the user's Claude subscription login instead of API credit.
 *
 * Locked down: no tools (`--tools ""`), no MCP servers, no saved session, and
 * it runs in an empty temporary folder so no project files or CLAUDE.md are
 * picked up. Document text is passed on stdin, and the answer must match the
 * JSON schema (`--json-schema`); it is validated again with zod.
 */

export type ClaudeRun = { code: number | null; stdout: string; stderr: string };
export const SYSTEM_PROMPT_FILE = 'system-prompt.md';
/** `files` are written into the CLI's empty working folder first (e.g. a long system prompt). */
export type ClaudeRunner = (args: string[], stdin: string, opts: { signal?: AbortSignal; timeoutMs: number; files?: Record<string, string> }) => Promise<ClaudeRun>;

/** Version string of the installed CLI, or null if it can't be run. */
export function claudeCodeVersion(cliPath: string): string | null {
  try {
    const r = spawnSync(cliPath, ['--version'], { timeout: 20_000, windowsHide: true, encoding: 'utf8' });
    return r.status === 0 && r.stdout ? r.stdout.trim() : null;
  } catch {
    return null;
  }
}

export function spawnClaude(cliPath: string, maxOutputTokens?: number): ClaudeRunner {
  return async (args, stdin, { signal, timeoutMs, files = {} }) => {
    const cwd = path.join(os.tmpdir(), `qamc-claude-${randomUUID()}`);
    await fs.mkdir(cwd, { recursive: true });
    for (const [name, content] of Object.entries(files)) await fs.writeFile(path.join(cwd, path.basename(name)), content, 'utf8');
    // Use the subscription login, never an API key or token inherited from server/.env.
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY;
    delete env.ANTHROPIC_AUTH_TOKEN;
    // Long structured answers (e.g. a full scenario workbook) need the full output allowance.
    if (maxOutputTokens) env.CLAUDE_CODE_MAX_OUTPUT_TOKENS = String(maxOutputTokens);
    try {
      return await new Promise<ClaudeRun>((resolve, reject) => {
        const child = spawn(cliPath, args, { cwd, env, windowsHide: true });
        let stdout = '';
        let stderr = '';
        let settled = false;
        const finish = (fn: () => void) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
          fn();
        };
        const timer = setTimeout(() => {
          child.kill();
          finish(() => reject(new AiError('TIMEOUT', `Claude Code did not finish within ${Math.round(timeoutMs / 1000)} s (AI_TIMEOUT_SECONDS).`)));
        }, timeoutMs);
        const onAbort = () => {
          child.kill();
          finish(() => reject(new AiError('CANCELLED', 'The request was cancelled.')));
        };
        signal?.addEventListener('abort', onAbort);
        child.stdout.on('data', (d: Buffer) => (stdout += d.toString('utf8')));
        child.stderr.on('data', (d: Buffer) => (stderr += d.toString('utf8')));
        child.on('error', (err: NodeJS.ErrnoException) =>
          finish(() =>
            reject(
              err.code === 'ENOENT'
                ? new AiError('NOT_CONNECTED', `Claude Code CLI not found ("${cliPath}"). Install Claude Code, or set CLAUDE_CODE_PATH in server/.env.`)
                : new AiError('API_ERROR', `Could not start Claude Code: ${err.message}`),
            ),
          ),
        );
        child.on('close', (code) => finish(() => resolve({ code, stdout, stderr })));
        child.stdin.on('error', () => {}); // the CLI may exit before reading everything
        child.stdin.end(stdin, 'utf8');
      });
    } finally {
      await fs.rm(cwd, { recursive: true, force: true }).catch(() => {});
    }
  };
}

type CliResult = {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  result?: string;
  stop_reason?: string | null;
  structured_output?: unknown;
  api_error_status?: number | null;
  usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
  modelUsage?: Record<string, unknown>;
};

export class ClaudeCodeAiClient implements AiClient {
  readonly model: string;
  readonly authSource = 'claude-code' as const;

  constructor(
    private config: AppConfig,
    readonly cliVersion: string,
    private run: ClaudeRunner = spawnClaude(config.ai.claudeCodePath, config.ai.maxOutputTokens),
  ) {
    this.model = config.ai.model;
  }

  /** No token-counting endpoint without the API: estimated from characters (+~1,600 per picture). */
  async countTokens({ system, content }: { system: string; content: AiContent }) {
    const pictures = content.filter((b) => b.type === 'image').length;
    return Math.ceil((system.length + textOf(content).length) / 3.5) + pictures * 1600;
  }

  async generate<S extends z.ZodType>({ system, content, schema, signal, timeoutMs }: StructuredRequest<S>): Promise<StructuredResult<z.infer<S>>> {
    if (content.some((b) => b.type !== 'text' && b.type !== 'image')) {
      throw new AiError('BAD_REQUEST', 'Only text and pictures can be sent through Claude Code.');
    }
    const hasPictures = content.some((b) => b.type === 'image');
    const inputTokens = await this.countTokens({ system, content });
    if (inputTokens > this.config.ai.maxInputTokens) {
      throw new AiError(
        'BUDGET_EXCEEDED',
        `The documents are about ${inputTokens.toLocaleString('en')} tokens (estimated), over the AI_MAX_INPUT_TOKENS budget of ${this.config.ai.maxInputTokens.toLocaleString('en')}. Analyse fewer documents at once, or raise the budget in server/.env.`,
      );
    }

    // Text only: plain stdin + one JSON result. With pictures: one stream-json user
    // message carrying text and image blocks, and an NDJSON event stream back.
    const args = [
      '-p',
      ...(hasPictures ? ['--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose'] : ['--output-format', 'json']),
      '--json-schema', JSON.stringify(betaZodOutputFormat(schema).schema),
      // From a file: a long prompt (e.g. the 60 KB QA skill) exceeds the Windows command-line limit.
      '--system-prompt-file', SYSTEM_PROMPT_FILE,
      '--tools', '',
      '--strict-mcp-config',
      '--no-session-persistence',
      '--model', this.model,
      '--effort', this.config.ai.effort,
    ];
    const stdin = hasPictures ? `${JSON.stringify({ type: 'user', message: { role: 'user', content } })}\n` : textOf(content);
    const out = await this.run(args, stdin, { signal, timeoutMs: timeoutMs ?? this.config.ai.timeoutMs, files: { [SYSTEM_PROMPT_FILE]: system } });
    const j = parseCliOutput(hasPictures ? { ...out, stdout: lastResultLine(out.stdout) } : out);

    if (j.stop_reason === 'refusal') throw new AiError('REFUSAL', 'Claude declined this request. Nothing was saved.');
    if (j.stop_reason === 'max_tokens') throw new AiError('TRUNCATED', 'The response was cut off before it was complete. Nothing was saved. Analyse fewer documents at once.');
    if (j.structured_output === undefined || j.structured_output === null) {
      throw new AiError('INVALID_OUTPUT', 'Claude Code did not return structured output. Nothing was saved.');
    }
    const data = parseStructured(schema, JSON.stringify(j.structured_output));
    const usedModel = Object.keys(j.modelUsage ?? {})[0] ?? this.model;
    return {
      data,
      model: `${usedModel} via Claude Code`,
      stopReason: j.stop_reason ?? null,
      inputTokens,
      usage: {
        inputTokens: j.usage?.input_tokens ?? 0,
        outputTokens: j.usage?.output_tokens ?? 0,
        cacheReadInputTokens: j.usage?.cache_read_input_tokens ?? 0,
        cacheCreationInputTokens: j.usage?.cache_creation_input_tokens ?? 0,
      },
    };
  }

  /** One tiny request, so "Test connection" proves the login and model really work. */
  async ping() {
    const r = await this.generate({
      system: 'Reply with JSON only.',
      content: [{ type: 'text', text: 'Return the word ready.' }],
      schema: z.object({ answer: z.string() }),
    });
    return { model: r.model, displayName: `Claude Code ${this.cliVersion.split(' ')[0]} (your Claude subscription)` };
  }
}

function textOf(content: AiContent) {
  return content.map((b) => (b.type === 'text' ? b.text : '')).join('\n\n');
}

/** stream-json output is one JSON event per line; the answer is the last "result" event. */
function lastResultLine(stdout: string) {
  const lines = stdout.split('\n').filter((l) => l.trim());
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      if ((JSON.parse(lines[i]) as { type?: string }).type === 'result') return lines[i];
    } catch {
      // not a JSON line
    }
  }
  return stdout;
}

function parseCliOutput({ code, stdout, stderr }: ClaudeRun): CliResult {
  let j: CliResult | null = null;
  try {
    j = JSON.parse(stdout) as CliResult;
  } catch {
    // not JSON: the CLI failed before producing a result
  }
  const message = (j?.result || stderr || stdout || `exit code ${code}`).trim().slice(0, 500);
  if (!j || j.is_error || j.subtype !== 'success') {
    if (/not logged in|log ?in|authenticat|unauthori[sz]ed|invalid api key|oauth/i.test(message)) {
      throw new AiError('AUTH', 'Claude Code is not signed in. Open a terminal, run `claude`, and log in with your Claude account.');
    }
    if (/usage limit|rate limit|limit reached|too many requests/i.test(message)) {
      throw new AiError('RATE_LIMIT', `Your Claude subscription usage limit was reached. Try again after it resets. (${message})`);
    }
    throw new AiError('API_ERROR', `Claude Code failed: ${message}`);
  }
  return j;
}
