import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { SkillSpecSchema as ScenarioWorkbookSchema } from '../src/agents/skillAnalyst.js';
import { loadConfig } from '../src/config.js';
import { AiError, createAiClient } from '../src/lib/ai.js';
import { ClaudeCodeAiClient, type ClaudeRunner } from '../src/lib/claudeCode.js';

const cfg = (over: Record<string, string> = {}) =>
  loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'file:./x.db', ANTHROPIC_API_KEY: '', ANTHROPIC_MODEL: 'claude-opus-5-5', AI_EFFORT: 'high', ...over });

/** Fake `claude -p`: records the call and returns a scripted CLI result. */
function fakeCli(result: object | string, code = 0) {
  const calls: { args: string[]; stdin: string; files?: Record<string, string> }[] = [];
  const run: ClaudeRunner = async (args, stdin, opts) => {
    calls.push({ args, stdin, files: opts.files });
    return { code, stdout: typeof result === 'string' ? result : JSON.stringify(result), stderr: '' };
  };
  return { run, calls };
}
const ok = (structured: unknown) => ({
  type: 'result',
  subtype: 'success',
  is_error: false,
  stop_reason: 'tool_use',
  result: JSON.stringify(structured),
  structured_output: structured,
  usage: { input_tokens: 1200, output_tokens: 300 },
  modelUsage: { 'claude-opus-5-5': {} },
});
const Small = z.object({ answer: z.string() });

describe('Claude Code engine (subscription, no API credit)', () => {
  it('runs claude -p locked down: no tools, no MCP, no saved session, JSON schema, model and effort', async () => {
    const { run, calls } = fakeCli(ok({ answer: 'ready' }));
    const ai = new ClaudeCodeAiClient(cfg(), '2.1.316 (Claude Code)', run);
    const r = await ai.generate({ system: 'SYSTEM PROMPT', content: [{ type: 'text', text: 'DOCUMENT TEXT' }], schema: Small });
    expect(r.data).toEqual({ answer: 'ready' });
    expect(r.model).toBe('claude-opus-5-5 via Claude Code');
    expect(r.usage).toMatchObject({ inputTokens: 1200, outputTokens: 300 });

    const { args, stdin } = calls[0];
    const flag = (name: string) => args[args.indexOf(name) + 1];
    expect(args[0]).toBe('-p');
    expect(flag('--tools')).toBe('');
    expect(args).toContain('--strict-mcp-config');
    expect(args).toContain('--no-session-persistence');
    expect(flag('--output-format')).toBe('json');
    expect(flag('--model')).toBe('claude-opus-5-5');
    expect(flag('--effort')).toBe('high');
    // the system prompt goes in a file (long prompts exceed the Windows command-line limit)
    expect(flag('--system-prompt-file')).toBe('system-prompt.md');
    expect(calls[0].files).toEqual({ 'system-prompt.md': 'SYSTEM PROMPT' });
    expect(args).not.toContain('SYSTEM PROMPT');
    expect(JSON.parse(flag('--json-schema')).type).toBe('object');
    // documents go on stdin, never on the command line
    expect(stdin).toBe('DOCUMENT TEXT');
    expect(args.join(' ')).not.toContain('DOCUMENT TEXT');
  });

  it('accepts the full scenario workbook schema', async () => {
    const empty = {   design: '',   wip_decision: '',   meta: { cr_no: '', title: '', module: '', phase: '', source: '', version: '' },   scenarios: { sheet_name: '', columns: [], group_headers: [], rows: [] },   matrices: [],   tables: [],   requirements: [],   clarifications: [], };
    const { run, calls } = fakeCli(ok(empty));
    const ai = new ClaudeCodeAiClient(cfg(), '2.1.316', run);
    const r = await ai.generate({ system: 's', content: [{ type: 'text', text: 'x' }], schema: ScenarioWorkbookSchema });
    expect(r.data.scenarios.rows).toEqual([]);
    const schema = JSON.parse(calls[0].args[calls[0].args.indexOf('--json-schema') + 1]);
    expect(Object.keys(schema.properties)).toEqual(Object.keys(empty));
  });

  it('the real QA skill request fits the Windows command-line limit (the 60 KB skill goes in a file)', async () => {
    const { SKILL_TEXT, APP_NOTE, SkillSpecSchema } = await import('../src/agents/skillAnalyst.js');
    const { run, calls } = fakeCli(ok({ answer: 'x' }));
    const ai = new ClaudeCodeAiClient(cfg(), '2.1.316', run);
    await ai.generate({ system: SKILL_TEXT + APP_NOTE, content: [{ type: 'text', text: 'doc' }], schema: SkillSpecSchema }).catch(() => {});
    const commandLine = calls[0].args.map((x) => `"${x}"`).join(' ');
    expect(SKILL_TEXT.length).toBeGreaterThan(32_767);
    expect(commandLine.length).toBeLessThan(30_000);
  });

  it.each([
    ['not signed in', { type: 'result', subtype: 'success', is_error: true, result: 'Not logged in · Please run /login' }, 'AUTH'],
    ['usage limit reached', { type: 'result', subtype: 'success', is_error: true, result: 'Claude usage limit reached. Your limit will reset at 5pm.' }, 'RATE_LIMIT'],
    ['an execution error', { type: 'result', subtype: 'error_during_execution', is_error: true, result: 'boom' }, 'API_ERROR'],
    ['output that is not JSON', 'Something went wrong', 'API_ERROR'],
    ['no structured output', { ...ok({ answer: 'x' }), structured_output: null }, 'INVALID_OUTPUT'],
    ['structured output with the wrong shape', ok({ wrong: 1 }), 'INVALID_OUTPUT'],
    ['a truncated answer', { ...ok({ answer: 'x' }), stop_reason: 'max_tokens' }, 'TRUNCATED'],
    ['a refusal', { ...ok({ answer: 'x' }), stop_reason: 'refusal' }, 'REFUSAL'],
  ])('reports %s as an error and returns no data', async (_label, result, code) => {
    const ai = new ClaudeCodeAiClient(cfg(), '2.1.316', fakeCli(result).run);
    const err = await ai.generate({ system: 's', content: [{ type: 'text', text: 'x' }], schema: Small }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiError);
    expect((err as AiError).code).toBe(code);
  });

  it('refuses over-budget input before running the CLI (pictures count toward the estimate)', async () => {
    const { run, calls } = fakeCli(ok({ answer: 'x' }));
    const ai = new ClaudeCodeAiClient(cfg({ AI_MAX_INPUT_TOKENS: '1000' }), '2.1.316', run);
    await expect(
      ai.generate({ system: 's', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }], schema: Small }),
    ).rejects.toMatchObject({ code: 'BUDGET_EXCEEDED' });
    await expect(ai.generate({ system: 's', content: [{ type: 'text', text: 'x'.repeat(10_000) }], schema: Small })).rejects.toMatchObject({ code: 'BUDGET_EXCEEDED' });
    expect(calls).toHaveLength(0);
  });

  it('Test connection makes one tiny request and names the subscription', async () => {
    const ai = new ClaudeCodeAiClient(cfg(), '2.1.316 (Claude Code)', fakeCli(ok({ answer: 'ready' })).run);
    expect(await ai.ping()).toEqual({ model: 'claude-opus-5-5 via Claude Code', displayName: 'Claude Code 2.1.316 (your Claude subscription)' });
  });

  it('is chosen only when allowed by AI_PROVIDER, and never when the CLI is missing', async () => {
    const missing = { CLAUDE_CODE_PATH: 'definitely-not-a-real-claude-binary' };
    expect(await createAiClient(cfg({ AI_PROVIDER: 'claude-code', ...missing }))).toBeNull();
    expect(await createAiClient(cfg({ AI_PROVIDER: 'auto', ...missing }))).toBeNull();
    // An API key wins in auto mode, and claude-code mode ignores the key.
    expect((await createAiClient(cfg({ AI_PROVIDER: 'auto', ANTHROPIC_API_KEY: 'sk-test', ...missing })))?.authSource).toBe('api-key');
    expect(await createAiClient(cfg({ AI_PROVIDER: 'claude-code', ANTHROPIC_API_KEY: 'sk-test', ...missing }))).toBeNull();
  });
});
