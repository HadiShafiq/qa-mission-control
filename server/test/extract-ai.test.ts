import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AnalysisSchema, resolveSource, type AnalysedDocument, type ExtractedRequirement } from '../src/agents/crAnalyst.js';
import { loadConfig } from '../src/config.js';
import { AiError, AnthropicAiClient, createAiClient } from '../src/lib/ai.js';
import { extractDocument } from '../src/lib/extract.js';
import { makeDocx, makePdf, makeXlsx } from './fixtures.js';

describe('document extraction with source references', () => {
  it('PDF: one segment per page, labelled with the page number', async () => {
    const pdf = makePdf([['Login rules', 'The password must have 8 characters.'], ['Approval', 'A supervisor approves applications over RM 5000.']]);
    const x = await extractDocument(pdf, 'PDF');
    expect(x.warnings).toEqual([]);
    expect(x.segments.map((s) => s.ref)).toEqual(['Page 1', 'Page 2']);
    expect(x.segments[1].text).toContain('A supervisor approves applications over RM 5000.');
  });

  it('PDF without a text layer reports that OCR is not supported instead of returning nothing silently', async () => {
    const x = await extractDocument(makePdf([[]]), 'PDF');
    expect(x.segments).toEqual([]);
    expect(x.warnings.join(' ')).toMatch(/no text layer/i);
  });

  it('broken PDF gives a readable warning, not a crash', async () => {
    const x = await extractDocument(Buffer.from('%PDF-1.4\nnot really a pdf'), 'PDF');
    expect(x.segments).toEqual([]);
    expect(x.warnings[0]).toMatch(/could not be read|no text/i);
  });

  it('DOCX: text grouped by heading, each table its own segment with numbered rows', async () => {
    const docx = await makeDocx([
      { p: 'Intro text before any heading.' },
      { h: 1, text: '2 Functional Requirements' },
      { h: 2, text: '2.1 Application submission' },
      { p: 'The applicant must upload a copy of the IC.' },
      { table: [['Field', 'Rule'], ['IC Number', 'Mandatory, 12 digits']] },
      { h: 2, text: '2.2 Approval' },
      { p: 'Applications are approved by the supervisor.' },
    ]);
    const x = await extractDocument(docx, 'DOCX');
    expect(x.segments.map((s) => s.ref)).toEqual(['Text at document start', 'Section "2.1 Application submission"', 'Table 1', 'Section "2.2 Approval"']);
    expect(x.segments[1].text).toBe('The applicant must upload a copy of the IC.');
    expect(x.segments[2].text).toBe('Row 1: | Field | Rule |\nRow 2: | IC Number | Mandatory, 12 digits |');
  });

  it('DOCX built from form tables (no heading styles): tables titled by their single-cell first row', async () => {
    const docx = await makeDocx([
      { table: [['A. Project Name :', 'eP-FL']] },
      { table: [['B. Change Request Details'], ['Resolution :', 'Threshold is checked per PR for non-contracted items.']] },
      { p: 'Approved by the steering committee.' },
    ]);
    const x = await extractDocument(docx, 'DOCX');
    expect(x.segments.map((s) => s.ref)).toEqual(['Table 1', 'Table 2 "B. Change Request Details"', 'Text after Table 2']);
  });

  it('XLSX: one segment per row with cell addresses', async () => {
    const xlsx = await makeXlsx({ 'Business Rules': [['ID', 'Rule'], ['BR-01', 'Officer can only view own cases'], [], ['BR-02', 'Max 3 attachments']] });
    const x = await extractDocument(xlsx, 'XLSX');
    expect(x.segments.map((s) => s.ref)).toEqual(["'Business Rules'!A1:B1", "'Business Rules'!A2:B2", "'Business Rules'!A4:B4"]);
    expect(x.segments[1].text).toBe('A2=BR-01 | B2=Officer can only view own cases');
  });

  it('images are passed to the model as images, with a warning that there is no text', async () => {
    const x = await extractDocument(Buffer.from([0x89, 0x50, 0x4e, 0x47]), 'PNG');
    expect(x.image).toEqual({ mediaType: 'image/png' });
    expect(x.segments).toEqual([]);
  });
});

describe('source verification', () => {
  const docs = (async () => {
    const pdf = await extractDocument(makePdf([['Intro'], ['A supervisor approves applications over RM 5000.']]), 'PDF');
    const xlsx = await extractDocument(await makeXlsx({ Rules: [['ID', 'Rule'], ['BR-01', 'Officer can only view own cases']] }), 'XLSX');
    const mk = (name: string, fileType: string, extraction: typeof pdf) =>
      ({ doc: { id: name, originalName: name, version: 1, fileType } as AnalysedDocument['doc'], extraction }) as AnalysedDocument;
    return [mk('spec.pdf', 'PDF', pdf), mk('rules.xlsx', 'XLSX', xlsx)];
  })();
  const item = (over: Partial<ExtractedRequirement>): ExtractedRequirement => ({
    documentIndex: 1,
    location: 'Page 2',
    quote: null,
    module: null,
    feature: null,
    description: 'x',
    requirementType: 'FUNCTIONAL',
    classification: 'EXPLICIT',
    businessRule: null,
    userRole: null,
    risk: 'MEDIUM',
    rationale: 'r',
    ...over,
  });

  it('verifies a quote at the cited page', async () => {
    const r = resolveSource(item({ quote: 'supervisor approves applications over RM 5000' }), await docs);
    expect(r).toMatchObject({ verified: true, reference: 'spec.pdf (v1) › Page 2' });
  });

  it('corrects a wrong page number to where the quote really is', async () => {
    const r = resolveSource(item({ location: 'Page 1', quote: 'A supervisor approves applications' }), await docs);
    expect(r).toMatchObject({ verified: true, reference: 'spec.pdf (v1) › Page 2' });
  });

  it('keeps a specific spreadsheet cell when it is in the matching row', async () => {
    const r = resolveSource(item({ documentIndex: 2, location: 'Rules!B2', quote: 'Officer can only view own cases' }), await docs);
    expect(r).toMatchObject({ verified: true, reference: 'rules.xlsx (v1) › Rules!B2' });
  });

  it('a quote that is not in any document is marked unverified (never trusted)', async () => {
    const r = resolveSource(item({ quote: 'Managers can delete any application' }), await docs);
    expect(r.verified).toBe(false);
    expect(r.reference).toBe('spec.pdf (v1) › Page 2');
  });

  it('keeps a Word table row reference only when the quote is in that row', async () => {
    const x = await extractDocument(
      await makeDocx([{ table: [['B. Change Request Details'], ['Justification :', 'Users asked for it.'], ['Resolution :', 'Threshold is checked per PR for non-contracted items.']] }]),
      'DOCX',
    );
    const d = [{ doc: { id: 'w', originalName: 'cr.docx', version: 1, fileType: 'DOCX' } as AnalysedDocument['doc'], extraction: x } as AnalysedDocument];
    const ref = 'Table 1 "B. Change Request Details"';
    expect(resolveSource(item({ location: `${ref}, Row 3`, quote: 'Threshold is checked per PR' }), d)).toMatchObject({ verified: true, reference: `cr.docx (v1) › ${ref}, Row 3` });
    // wrong row: still verified (the quote is in the table) but the reference falls back to the table
    expect(resolveSource(item({ location: `${ref}, Row 2`, quote: 'Threshold is checked per PR' }), d)).toMatchObject({ verified: true, reference: `cr.docx (v1) › ${ref}` });
  });

  it('very short quotes do not count as verification', async () => {
    expect(resolveSource(item({ quote: 'RM' }), await docs).verified).toBe(false);
  });
});

// ─────────── Anthropic client: exact request shape, via a fake fetch (no network) ───────────

function sse(events: object[]) {
  const body = events.map((e) => `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}
function streamOf(text: string, stopReason = 'end_turn') {
  return sse([
    { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 40, output_tokens: 1 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 20 } },
    { type: 'message_stop' },
  ]);
}

function fakeFetch(handler: (url: string, body: Record<string, unknown>) => Response) {
  const requests: { url: string; body: Record<string, unknown>; headers: Headers }[] = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    requests.push({ url, body, headers: new Headers(init?.headers) });
    return handler(url, body);
  }) as typeof fetch;
  return { f, requests };
}

const cfg = (over: Record<string, string> = {}) => loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'file:./x.db', ANTHROPIC_API_KEY: 'sk-test-not-real', ANTHROPIC_MODEL: 'claude-opus-5-5', AI_PROVIDER: 'anthropic-api', AI_EFFORT: 'high', AI_MAX_OUTPUT_TOKENS: '64000', AI_MAX_RETRIES: '0', ...over });
const Small = z.object({ answer: z.string() });

describe('Anthropic client', () => {
  it('is not created without an API key or a login profile', async () => {
    expect(await createAiClient(cfg({ ANTHROPIC_API_KEY: '' }))).toBeNull();
  });

  it('uses an `ant auth login` profile when there is no API key, and the key when there is one', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const dir = path.join(process.env.QAMC_TEST_DIR!, 'fake-ant-profile');
    fs.mkdirSync(path.join(dir, 'configs'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'configs', 'default.json'), JSON.stringify({ authentication: { type: 'user_oauth' } }));
    const before = process.env.ANTHROPIC_CONFIG_DIR;
    process.env.ANTHROPIC_CONFIG_DIR = dir;
    try {
      expect((await createAiClient(cfg({ ANTHROPIC_API_KEY: '' })))?.authSource).toBe('ant-profile');
      expect((await createAiClient(cfg()))?.authSource).toBe('api-key');
    } finally {
      process.env.ANTHROPIC_CONFIG_DIR = before;
    }
  });

  it('sends a structured-output, adaptive-thinking request with refusal fallback and validates the result', async () => {
    const { f, requests } = fakeFetch((url) => (url.includes('count_tokens') ? Response.json({ input_tokens: 1234 }) : streamOf('{"answer":"42"}')));
    const ai = new AnthropicAiClient(cfg(), { fetch: f });
    const r = await ai.generate({ system: 'sys', content: [{ type: 'text', text: 'hi' }], schema: Small });
    expect(r.data).toEqual({ answer: '42' });
    expect(r.inputTokens).toBe(1234);
    expect(r.usage.outputTokens).toBe(20);

    const msg = requests.find((q) => q.url.endsWith('/v1/messages?beta=true') || (q.url.includes('/v1/messages') && !q.url.includes('count_tokens')))!;
    expect(msg.body).toMatchObject({ model: 'claude-opus-5-5', stream: true, thinking: { type: 'adaptive' }, fallbacks: 'default', max_tokens: 64000 });
    expect((msg.body.output_config as { format: { type: string } }).format.type).toBe('json_schema');
    expect((msg.body.output_config as { effort: string }).effort).toBe('high');
    expect(msg.headers.get('anthropic-beta')).toContain('server-side-fallback-2026-07-01');
  });

  it('refuses over-budget input before sending the analysis request', async () => {
    const { f, requests } = fakeFetch(() => Response.json({ input_tokens: 500_000 }));
    const ai = new AnthropicAiClient(cfg({ AI_MAX_INPUT_TOKENS: '100000' }), { fetch: f });
    await expect(ai.generate({ system: 's', content: [{ type: 'text', text: 'x' }], schema: Small })).rejects.toMatchObject({ code: 'BUDGET_EXCEEDED' });
    expect(requests.every((q) => q.url.includes('count_tokens'))).toBe(true);
  });

  it.each([
    ['truncated output', streamOf('{"answer":"4', 'max_tokens'), 'TRUNCATED'],
    ['a refusal', streamOf('', 'refusal'), 'REFUSAL'],
    ['JSON that does not match the schema', streamOf('{"wrong":1}'), 'INVALID_OUTPUT'],
  ])('reports %s as an error and returns no data', async (_label, response, code) => {
    const { f } = fakeFetch((url) => (url.includes('count_tokens') ? Response.json({ input_tokens: 10 }) : response));
    const ai = new AnthropicAiClient(cfg(), { fetch: f });
    const err = await ai.generate({ system: 's', content: [{ type: 'text', text: 'x' }], schema: Small }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiError);
    expect((err as AiError).code).toBe(code);
  });

  it('explains an empty credit balance instead of showing the raw API error', async () => {
    const { f } = fakeFetch(() =>
      Response.json({ type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API.' } }, { status: 400 }),
    );
    const ai = new AnthropicAiClient(cfg(), { fetch: f });
    await expect(ai.ping()).rejects.toMatchObject({ code: 'BILLING', message: expect.stringMatching(/Plans & Billing/) });
  });

  it('maps an invalid key to a clear message', async () => {
    const { f } = fakeFetch(() => Response.json({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }, { status: 401 }));
    const ai = new AnthropicAiClient(cfg(), { fetch: f });
    await expect(ai.ping()).rejects.toMatchObject({ code: 'AUTH', message: expect.stringMatching(/ANTHROPIC_API_KEY/) });
  });

  it('the analysis schema is accepted by structured outputs conversion', async () => {
    const { f, requests } = fakeFetch((url) =>
      url.includes('count_tokens') ? Response.json({ input_tokens: 10 }) : streamOf(JSON.stringify({ crSummary: 's', impactedModules: [], regressionImpact: [], requirements: [] })),
    );
    const ai = new AnthropicAiClient(cfg(), { fetch: f });
    const r = await ai.generate({ system: 's', content: [{ type: 'text', text: 'x' }], schema: AnalysisSchema });
    expect(r.data.requirements).toEqual([]);
    const schema = (requests.at(-1)!.body.output_config as { format: { schema: { properties: Record<string, unknown> } } }).format.schema;
    expect(Object.keys(schema.properties)).toEqual(['crSummary', 'impactedModules', 'regressionImpact', 'requirements']);
  });
});
