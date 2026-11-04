import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { renderDocuments, resolveSource, type AnalysedDocument } from '../src/agents/documents.js';
import type { ScenarioAnswer } from '../src/agents/scenarioAnalyst.js';
import { loadConfig } from '../src/config.js';
import { ClaudeCodeAiClient, type ClaudeRunner } from '../src/lib/claudeCode.js';
import { extractDocument } from '../src/lib/extract.js';
import { ScriptedAi, makeDocx, makePng, promptText } from './fixtures.js';
import { makeTestApp, multipart } from './helpers.js';

// A CR with before/after screens, like FL30753's Appendix A / B, plus a WMF icon.
const BEFORE = makePng(24, 24, [200, 200, 200]);
const AFTER = makePng(24, 24, [20, 60, 220]);
const WMF = Buffer.from([0xd7, 0xcd, 0xc6, 0x9a, 0, 0, 0, 0]);
const crWithScreens = () =>
  makeDocx([
    { table: [['B. Change Request Details'], ['Priority :', 'see icons']] },
    { image: WMF, ext: 'wmf' },
    { p: 'Appendix A – Screen Before Enhancement' },
    { p: 'Process : DO Creation' },
    { image: BEFORE, ext: 'png' },
    { p: 'Appendix B – Screen After Enhancement' },
    { p: 'Process : DO Creation' },
    { image: AFTER, ext: 'png' },
    { p: 'Display new alert message and allow to proceed if the accumulated Delivery Amount has exceeded PR threshold value' },
  ]);
const cr = { crNumber: 'CR1', version: '1.0', title: 'T', description: null, project: { code: 'P' } } as Parameters<typeof renderDocuments>[0];

describe('pictures inside Word documents', () => {
  it('are extracted in order, marked [Image N] where they appear, and unreadable formats are reported', async () => {
    const x = await extractDocument(await crWithScreens(), 'DOCX');
    expect(x.images.map((i) => [i.ref, i.mediaType, i.context])).toEqual([
      ['Image 2', 'image/png', 'Text after Table 1'],
      ['Image 3', 'image/png', 'Text after Table 1'],
    ]);
    expect(x.images[0].data.equals(BEFORE)).toBe(true);
    const text = x.segments.find((s) => s.ref === 'Text after Table 1')!.text;
    expect(text).toContain('Process : DO Creation\n[Image 2]');
    expect(text).toContain('[Image 1: X-WMF picture that cannot be read]');
    // information is a note, only the unreadable picture is a warning
    expect(x.notes).toEqual(['2 picture(s) (e.g. screenshots) are sent to the AI with the text.']);
    expect(x.warnings).toEqual(['1 picture(s) cannot be read by the AI (X-WMF): Image 1. Check them in the document yourself.']);
  });

  it('are sent to the analyst as image blocks, each labelled with its document, number and position', async () => {
    const x = await extractDocument(await crWithScreens(), 'DOCX');
    const doc = { id: 'd1', originalName: 'cr.docx', version: 1, fileType: 'DOCX' } as AnalysedDocument['doc'];
    const content = renderDocuments(cr, [{ doc, extraction: x }], '', 'Analyse.');
    expect(content.filter((b) => b.type === 'image')).toHaveLength(2);
    expect(promptText(content)).toContain('Document 1 (cr.docx), Image 3, which appears in Text after Table 1:');
    expect(promptText(content)).toContain('(2 picture(s) from this document are attached after the text');
  });

  it('a scenario taken from a picture points at that picture (unverified, since pictures cannot be text-checked)', async () => {
    const x = await extractDocument(await crWithScreens(), 'DOCX');
    const d = [{ doc: { id: 'd1', originalName: 'cr.docx', version: 1, fileType: 'DOCX' } as AnalysedDocument['doc'], extraction: x }];
    expect(resolveSource({ documentIndex: 1, location: 'Image 3', quote: 'Accumulated Delivery Amount is exceeded' }, d)).toMatchObject({
      verified: false,
      reference: 'cr.docx (v1) › Image 3 (in Text after Table 1)',
    });
  });
});

describe('Claude Code engine with pictures', () => {
  const cfg = loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'file:./x.db', ANTHROPIC_API_KEY: '', ANTHROPIC_MODEL: 'claude-opus-5-5', AI_EFFORT: 'high' });

  it('sends text and pictures as one stream-json message and reads the last result event', async () => {
    const calls: { args: string[]; stdin: string }[] = [];
    const run: ClaudeRunner = async (args, stdin) => {
      calls.push({ args, stdin });
      const events = [
        { type: 'system', subtype: 'init' },
        { type: 'assistant', message: {} },
        { type: 'result', subtype: 'success', is_error: false, stop_reason: 'tool_use', structured_output: { colour: 'blue' }, usage: { input_tokens: 5, output_tokens: 7 }, modelUsage: { 'claude-opus-5-5': {} } },
      ];
      return { code: 0, stdout: events.map((e) => JSON.stringify(e)).join('\n') + '\n', stderr: '' };
    };
    const ai = new ClaudeCodeAiClient(cfg, '2.1.316', run);
    const r = await ai.generate({
      system: 's',
      content: [
        { type: 'text', text: 'What colour?' },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: AFTER.toString('base64') } },
      ],
      schema: z.object({ colour: z.string() }),
    });
    expect(r.data).toEqual({ colour: 'blue' });
    const { args, stdin } = calls[0];
    expect(args).toEqual(expect.arrayContaining(['--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose']));
    expect(args[args.indexOf('--tools') + 1]).toBe(''); // still no tools
    const msg = JSON.parse(stdin.trim());
    expect(msg).toMatchObject({ type: 'user', message: { role: 'user' } });
    expect(msg.message.content.map((b: { type: string }) => b.type)).toEqual(['text', 'image']);
  });

  it('text-only requests keep the plain stdin path', async () => {
    const calls: string[][] = [];
    const run: ClaudeRunner = async (args) => {
      calls.push(args);
      return { code: 0, stdout: JSON.stringify({ type: 'result', subtype: 'success', is_error: false, structured_output: { colour: 'red' } }), stderr: '' };
    };
    await new ClaudeCodeAiClient(cfg, '2.1.316', run).generate({ system: 's', content: [{ type: 'text', text: 'x' }], schema: z.object({ colour: z.string() }) });
    expect(calls[0]).not.toContain('--input-format');
    expect(calls[0][calls[0].indexOf('--output-format') + 1]).toBe('json');
  });
});

describe('scenario generation for a CR with screenshots, end to end (scripted AI)', () => {
  const answer: ScenarioAnswer = {
    dimensions: [],
    wip: { applicable: false, statement: 'n/a' },
    enhancement: { applicable: true, statement: 'Before/after screens' },
    scenarios: [
      {
        key: 'S1', requirementRef: 'Appendix B', documentIndex: 1, location: 'Image 3', quote: null, module: 'FL', functionScreen: 'DO Creation',
        types: ['Enhancement'], enhancementState: 'After Enhancement', transactionState: 'N/A', status: 'Pending Fulfilment', role: 'Supplier',
        businessCondition: 'Accumulated amount > threshold', existingValue: 'N/A', actionChange: 'Submit', confirmation: 'N/A', testData: 'N/A',
        description: 'Verify the new alert appears above the Delivery Amount field.', expectedResult: 'Blue alert banner shown.', priority: 'Medium', regression: false, remarks: '',
      },
    ],
    decisionTables: [],
    requirementCoverage: [],
    clarifications: [],
    wipCoverage: [],
    enhancementCoverage: [],
    selfReview: [],
  };
  const ai = new ScriptedAi(({ content }) => {
    expect(content.filter((b) => b.type === 'image')).toHaveLength(2);
    return answer;
  });
  let t: Awaited<ReturnType<typeof makeTestApp>>;
  beforeAll(async () => (t = await makeTestApp({}, { ai })));
  afterAll(() => t.app.close());

  it('stores the picture reference, and the preview lists and serves the pictures', async () => {
    const p = await t.app.inject({ method: 'POST', url: '/api/projects', payload: { code: 'PIC', name: 'Pictures' } });
    const crRes = await t.app.inject({ method: 'POST', url: `/api/projects/${p.json().id}/crs`, payload: { crNumber: 'CR5000', title: 'Screens' } });
    const crId = crRes.json().id;
    const up = await t.app.inject({ method: 'POST', url: `/api/crs/${crId}/documents`, ...multipart([{ name: 'cr.docx', content: await crWithScreens() }]) });
    const docId = up.json()[0].id;

    const x = (await t.app.inject({ method: 'GET', url: `/api/crs/${crId}/extraction` })).json();
    expect(x[0].images.map((i: { ref: string }) => i.ref)).toEqual(['Image 2', 'Image 3']);
    expect(x[0].images[0].data).toBeUndefined(); // metadata only
    const pic = await t.app.inject({ method: 'GET', url: `/api/documents/${docId}/images/3` });
    expect(pic.statusCode).toBe(200);
    expect(pic.headers['content-type']).toBe('image/png');
    expect(pic.rawPayload.equals(AFTER)).toBe(true);
    expect((await t.app.inject({ method: 'GET', url: `/api/documents/${docId}/images/1` })).statusCode).toBe(404); // WMF is not served

    await t.app.inject({ method: 'POST', url: `/api/crs/${crId}/generate-scenarios`, payload: {} });
    await (t.app as unknown as { qamc: { runner: { idle(): Promise<void> } } }).qamc.runner.idle();
    const { scenarios } = (await t.app.inject({ method: 'GET', url: `/api/crs/${crId}/scenarios` })).json();
    expect(scenarios[0]).toMatchObject({ scenarioCode: 'CR5000-TS-001', sourceReference: 'cr.docx (v1) › Image 3 (in Text after Table 1)', sourceVerified: false });
  });
});
