import Anthropic from '@anthropic-ai/sdk';
import { loadConfig as loadAnthropicProfile } from '@anthropic-ai/sdk/core/credentials';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { z } from 'zod';
import type { AppConfig } from '../config.js';

/**
 * Thin wrapper around the Anthropic SDK used by every agent.
 *
 * - Structured output: the response is constrained to a JSON schema
 *   (`output_config.format`) and then validated again with zod. A response that
 *   does not validate is an error — it is never stored "as best we can".
 * - Budget: input tokens are counted before sending; over-budget requests are
 *   refused instead of silently truncating documents.
 * - Retries: the SDK retries 408/409/429/5xx and connection errors up to
 *   AI_MAX_RETRIES times. Nothing else is retried.
 * - Refusals: Opus/Sonnet 5.x requests opt into server-side fallback
 *   (`fallbacks: "default"`); a refusal that survives the fallback is reported
 *   as an error.
 */

export type AiContent = Anthropic.Beta.BetaContentBlockParam[];

export type AiUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
};

export type StructuredRequest<S extends z.ZodType> = {
  system: string;
  content: AiContent;
  schema: S;
  signal?: AbortSignal;
  /** Overrides AI_TIMEOUT_SECONDS for long jobs. */
  timeoutMs?: number;
};

export type StructuredResult<T> = { data: T; model: string; usage: AiUsage; stopReason: string | null; inputTokens: number };

/** How the app reaches Claude: API key, `ant auth login` profile, or the Claude Code CLI (subscription). */
export type AiAuthSource = 'api-key' | 'ant-profile' | 'claude-code';

export interface AiClient {
  readonly model: string;
  readonly authSource?: AiAuthSource;
  countTokens(req: { system: string; content: AiContent }): Promise<number>;
  generate<S extends z.ZodType>(req: StructuredRequest<S>): Promise<StructuredResult<z.infer<S>>>;
  /** Cheap request that proves the key and model work. */
  ping(): Promise<{ model: string; displayName: string }>;
}

export class AiError extends Error {
  constructor(
    public code:
      | 'NOT_CONNECTED'
      | 'AUTH'
      | 'PERMISSION'
      | 'MODEL_NOT_FOUND'
      | 'RATE_LIMIT'
      | 'OVERLOADED'
      | 'BAD_REQUEST'
      | 'BILLING'
      | 'CONNECTION'
      | 'TIMEOUT'
      | 'BUDGET_EXCEEDED'
      | 'REFUSAL'
      | 'TRUNCATED'
      | 'INVALID_OUTPUT'
      | 'CANCELLED'
      | 'API_ERROR',
    message: string,
  ) {
    super(message);
  }
}

/** Models that accept the server-side refusal fallback (`fallbacks: "default"`). */
function supportsDefaultFallback(model: string) {
  return /^claude-(opus-5|fable-5|sonnet-5-5)/.test(model);
}

/**
 * ANTHROPIC_API_KEY wins when set. Otherwise the SDK's own credential chain is
 * used if it finds an `ant auth login` profile (on Windows under
 * %APPDATA%Anthropic). With neither, AI is "not connected".
 */
export async function createAiClient(config: AppConfig): Promise<AiClient | null> {
  const provider = config.ai.provider;
  if (provider !== 'claude-code' && config.ai.configured) return new AnthropicAiClient(config, { authSource: 'api-key' });
  if (provider !== 'anthropic-api') {
    const { ClaudeCodeAiClient, claudeCodeVersion } = await import('./claudeCode.js');
    const version = claudeCodeVersion(config.ai.claudeCodePath);
    if (version) return new ClaudeCodeAiClient(config, version);
    if (provider === 'claude-code') return null;
  }
  try {
    if (await loadAnthropicProfile()) return new AnthropicAiClient(config, { authSource: 'ant-profile' });
  } catch {
    // e.g. ANTHROPIC_PROFILE names a profile that doesn't exist: treat as not connected
  }
  return null;
}

export class AnthropicAiClient implements AiClient {
  private client: Anthropic;
  readonly model: string;
  readonly authSource: AiAuthSource;

  /** `fetch` is only overridden by tests that check the exact request sent. */
  constructor(
    private config: AppConfig,
    options: { fetch?: typeof fetch; authSource?: AiAuthSource } = {},
  ) {
    this.model = config.ai.model;
    this.authSource = options.authSource ?? 'api-key';
    this.client = new Anthropic({
      // No apiKey for a login profile: the SDK resolves and refreshes the profile token itself.
      ...(this.authSource === 'api-key' ? { apiKey: config.ai.apiKey } : {}),
      maxRetries: config.ai.maxRetries,
      timeout: config.ai.timeoutMs,
      ...(options.fetch ? { fetch: options.fetch } : {}),
    });
  }

  async countTokens({ system, content }: { system: string; content: AiContent }) {
    try {
      const r = await this.client.beta.messages.countTokens({
        model: this.model,
        system,
        messages: [{ role: 'user', content }],
      });
      return r.input_tokens;
    } catch (err) {
      throw toAiError(err);
    }
  }

  async generate<S extends z.ZodType>({ system, content, schema, signal, timeoutMs }: StructuredRequest<S>): Promise<StructuredResult<z.infer<S>>> {
    const inputTokens = await this.countTokens({ system, content });
    if (inputTokens > this.config.ai.maxInputTokens) {
      throw new AiError(
        'BUDGET_EXCEEDED',
        `The documents need about ${inputTokens.toLocaleString('en')} input tokens, which is over the AI_MAX_INPUT_TOKENS budget of ${this.config.ai.maxInputTokens.toLocaleString('en')}. Archive documents that aren't needed, split the CR, or raise the budget in server/.env.`,
      );
    }

    let message: Anthropic.Beta.BetaMessage;
    try {
      const fallback = supportsDefaultFallback(this.model);
      const stream = this.client.beta.messages.stream(
        {
          model: this.model,
          max_tokens: this.config.ai.maxOutputTokens,
          thinking: { type: 'adaptive' },
          // Send only the JSON schema: we check stop_reason (refusal / max_tokens)
          // before parsing, which the SDK's auto-parsing would skip.
          output_config: { effort: this.config.ai.effort, format: { type: 'json_schema', schema: betaZodOutputFormat(schema).schema } },
          system,
          messages: [{ role: 'user', content }],
          ...(fallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
        },
        { signal, ...(timeoutMs ? { timeout: timeoutMs } : {}) },
      );
      message = await stream.finalMessage();
    } catch (err) {
      throw toAiError(err);
    }

    if (message.stop_reason === 'refusal') {
      const cat = message.stop_details?.category;
      throw new AiError('REFUSAL', `The model declined this request${cat ? ` (category: ${cat})` : ''}. Nothing was saved.`);
    }
    if (message.stop_reason === 'max_tokens') {
      throw new AiError(
        'TRUNCATED',
        `The response was cut off at the AI_MAX_OUTPUT_TOKENS limit (${this.config.ai.maxOutputTokens.toLocaleString('en')}). Nothing was saved. Raise the limit or analyse fewer documents at once.`,
      );
    }

    const text = message.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    const data = parseStructured(schema, text);
    const u = message.usage;
    return {
      data,
      model: message.model,
      stopReason: message.stop_reason,
      inputTokens,
      usage: {
        inputTokens: u.input_tokens,
        outputTokens: u.output_tokens,
        cacheReadInputTokens: u.cache_read_input_tokens ?? 0,
        cacheCreationInputTokens: u.cache_creation_input_tokens ?? 0,
      },
    };
  }

  async ping() {
    try {
      const m = await this.client.models.retrieve(this.model);
      return { model: m.id, displayName: m.display_name };
    } catch (err) {
      throw toAiError(err);
    }
  }
}

/** Parse and validate model output. Shared with test doubles. */
export function parseStructured<S extends z.ZodType>(schema: S, text: string): z.infer<S> {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new AiError('INVALID_OUTPUT', 'The model did not return valid JSON. Nothing was saved.');
  }
  const r = schema.safeParse(json);
  if (!r.success) {
    const first = r.error.issues[0];
    throw new AiError('INVALID_OUTPUT', `The model's output did not match the expected structure (${first?.path.join('.') || 'root'}: ${first?.message}). Nothing was saved.`);
  }
  return r.data;
}

export function toAiError(err: unknown): AiError {
  if (err instanceof AiError) return err;
  if (err instanceof Anthropic.APIUserAbortError) return new AiError('CANCELLED', 'The request was cancelled.');
  if (err instanceof Anthropic.AuthenticationError) return new AiError('AUTH', 'Anthropic rejected the credentials. Check ANTHROPIC_API_KEY in server/.env, or run `ant auth login` again if you use a login profile.');
  if (err instanceof Anthropic.PermissionDeniedError) return new AiError('PERMISSION', 'This API key is not allowed to use the configured model.');
  if (err instanceof Anthropic.NotFoundError) return new AiError('MODEL_NOT_FOUND', 'The configured model was not found. Check ANTHROPIC_MODEL in server/.env.');
  if (err instanceof Anthropic.RateLimitError) return new AiError('RATE_LIMIT', 'Rate limited by the Anthropic API after retries. Wait a minute and run it again.');
  if (err instanceof Anthropic.BadRequestError && /credit balance/i.test(err.message)) {
    return new AiError('BILLING', 'Your Anthropic account has no API credit left. Add credit at platform.claude.com → Plans & Billing, then run the analysis again. Nothing was saved.');
  }
  if (err instanceof Anthropic.BadRequestError) return new AiError('BAD_REQUEST', `The Anthropic API rejected the request: ${err.message}`);
  if (err instanceof Anthropic.APIConnectionTimeoutError) return new AiError('TIMEOUT', 'The Anthropic API did not respond in time (AI_TIMEOUT_SECONDS).');
  if (err instanceof Anthropic.APIConnectionError) return new AiError('CONNECTION', 'Could not reach the Anthropic API. Check your internet connection or proxy.');
  if (err instanceof Anthropic.InternalServerError) return new AiError('OVERLOADED', 'The Anthropic API is overloaded or had an internal error. Try again shortly.');
  if (err instanceof Anthropic.APIError) return new AiError('API_ERROR', `Anthropic API error ${err.status ?? ''}: ${err.message}`.trim());
  return new AiError('API_ERROR', err instanceof Error ? err.message : String(err));
}
