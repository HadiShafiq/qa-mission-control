import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ScenarioAnswer } from '../src/agents/scenarioAnalyst.js';
import { SHEETS } from '../src/exports/scenarioWorkbook.js';
import { ScriptedAi, makeDocx, makePng, promptText } from './fixtures.js';
import { makeTestApp, multipart } from './helpers.js';

const FRS = () =>
  makeDocx([
    { h: 2, text: 'FR-3657-02 — Quotation and Panel' },
    { p: 'For Quotation and Panel, retain the original CR#3657 validation behaviour.' },
    { h: 2, text: 'FR-3657-04 — Tender: no fully completed zone' },
    { p: 'If none of the available Tender zones is fully completed, the system shall prevent completion and display the bilingual minimum-one-zone message.' },
    { p: 'Appendix A screen' },
    { image: makePng(), ext: 'png' },
  ]);

const scenario = (key: string, over: Partial<ScenarioAnswer['scenarios'][number]> = {}): ScenarioAnswer['scenarios'][number] => ({
  key,
  requirementRef: 'FR-3657-04',
  documentIndex: 1,
  location: 'Section "FR-3657-04 — Tender: no fully completed zone"',
  quote: 'the system shall prevent completion',
  module: 'QT',
  functionScreen: 'Financial Proposal',
  types: ['Negative', 'Validation'],
  enhancementState: 'After Enhancement',
  transactionState: 'N/A',
  status: 'Pending Proposal Preparation',
  role: 'Supplier',
  businessCondition: 'Method = Tender; no zone fully completed',
  existingValue: 'N/A',
  actionChange: 'Click Complete',
  confirmation: 'N/A',
  testData: 'Tender with 2 zones, none complete',
  description: 'Verify Complete is blocked when no Tender zone is fully completed.',
  expectedResult: 'System prevents completion and displays the minimum-one-zone message.',
  priority: 'High',
  regression: false,
  remarks: '',
  ...over,
});

const ANSWER: ScenarioAnswer = {
  dimensions: [
    { name: 'Procurement Method', values: ['Quotation', 'Panel', 'Tender'], applicability: 'Applicable', drivesBehaviour: true, needsSeparateScenarios: true, inDecisionTable: true, sourceRef: 'FR-3657-02, FR-3657-04', notes: '' },
    { name: 'Transaction State (WIP)', values: [], applicability: 'Not applicable', drivesBehaviour: false, needsSeparateScenarios: false, inDecisionTable: false, sourceRef: '', notes: 'Not mentioned' },
  ],
  wip: { applicable: false, statement: 'The FRS does not describe WIP or pending transactions.' },
  enhancement: { applicable: true, statement: 'Tender behaviour changes after the enhancement.' },
  scenarios: [
    scenario('S1'),
    scenario('S2', { requirementRef: 'FR-3657-02', location: 'Section "FR-3657-02 — Quotation and Panel"', quote: 'retain the original CR#3657 validation behaviour', types: ['Positive', 'Regression'], regression: true, priority: 'Medium' }),
    scenario('S3', { quote: 'a sentence that is not in the FRS at all', types: ['Boundary'] }),
  ],
  decisionTables: [
    {
      title: 'Method × Zone completion',
      requirementRef: 'FR-3657-04',
      combinations: [
        { scenarioKey: 'S1', values: [{ condition: 'Method', value: 'Tender' }, { condition: 'Zone', value: 'None complete' }], expectedResult: 'Block', status: 'Covered', note: '' },
        { scenarioKey: 'S2', values: [{ condition: 'Method', value: 'Quotation' }, { condition: 'Zone', value: 'All complete' }], expectedResult: 'Allow', status: 'Covered', note: '' },
        { scenarioKey: 'S9', values: [{ condition: 'Method', value: 'Panel' }, { condition: 'Zone', value: 'None complete' }], expectedResult: 'Block', status: 'Covered', note: '' },
        { scenarioKey: null, values: [{ condition: 'Method', value: 'Tender' }, { condition: 'Zone', value: 'One complete, one partial' }], expectedResult: 'TBD', status: 'TBD', note: 'CL-02' },
      ],
    },
  ],
  requirementCoverage: [
    { requirementRef: 'FR-3657-04', requirement: 'Tender with no complete zone is blocked', applicableConditions: 'Method, Zone', scenarioKeys: ['S1', 'S3'], statusCoverage: 'Pending Proposal Preparation', roleCoverage: 'Supplier', enhancementCoverage: 'After', transactionStateCoverage: 'N/A', decisionTableCoverage: 'Yes', coverageStatus: 'Covered', remarks: '' },
    { requirementRef: 'FR-3657-07', requirement: 'Zone message uses zone name', applicableConditions: 'Zone', scenarioKeys: [], statusCoverage: '', roleCoverage: '', enhancementCoverage: '', transactionStateCoverage: '', decisionTableCoverage: '', coverageStatus: 'Covered', remarks: '' },
  ],
  clarifications: [{ requirementRef: 'FR-3657-06', issue: 'Partial zone combination', why: 'Not defined', impact: 'Cannot write expected result', question: 'Must partial entries be cleared?' }],
  wipCoverage: [{ requirementRef: 'x', businessRule: 'x', transactionState: 'WIP', scenarioKey: 'S1', expectedBehaviour: 'x', coverageStatus: 'Covered', remarks: '' }],
  enhancementCoverage: [{ requirementRef: 'FR-3657-04', functionScreen: 'Financial Proposal', before: 'All zones required', after: 'At least one zone', scenarioKey: 'S1', expectedResult: 'Block when none complete', coverageStatus: 'Covered', remarks: '' }],
  selfReview: [{ area: 'Requirement', check: 'Entire CR / FRS analysed', result: 'Pass', note: '' }],
};

describe('QA test scenario workbook (user prompt)', () => {
  const ai = new ScriptedAi(() => ANSWER);
  let t: Awaited<ReturnType<typeof makeTestApp>>;
  let crId = '';
  let task: { status: string; error: string | null; output: Record<string, unknown> };
  beforeAll(async () => {
    t = await makeTestApp({}, { ai });
    const p = await t.app.inject({ method: 'POST', url: '/api/projects', payload: { code: 'QT', name: 'Quotation' } });
    crId = (await t.app.inject({ method: 'POST', url: `/api/projects/${p.json().id}/crs`, payload: { crNumber: 'CR3657', title: 'Unit price validation' } })).json().id;
    await t.app.inject({ method: 'POST', url: `/api/crs/${crId}/documents`, ...multipart([{ name: 'frs.docx', content: await FRS() }]) });
    const r = await t.app.inject({ method: 'POST', url: `/api/crs/${crId}/generate-scenarios`, payload: {} });
    expect(r.statusCode).toBe(202);
    await (t.app as unknown as { qamc: { runner: { idle(): Promise<void> } } }).qamc.runner.idle();
    task = (await t.app.inject({ method: 'GET', url: `/api/tasks/${r.json().id}` })).json();
  });
  afterAll(() => t.app.close());

  it('uses the user prompt word for word, documents as untrusted data, and sends pictures', () => {
    const call = ai.calls[0];
    expect(call.system).toContain('# 3. IMPORTANT – DO NOT CONFUSE DIFFERENT TYPES OF "WIP"');
    expect(call.system).toContain('WIP / Non-WIP Transaction State: N/A based on source requirement.');
    expect(call.system).toMatch(/untrusted data/);
    expect(call.content.filter((b) => b.type === 'image')).toHaveLength(1);
    expect(promptText(call.content)).toContain('FR-3657-04');
  });

  it('completes, saves a versioned workbook and reports the application checks', () => {
    expect(task.status).toBe('COMPLETED');
    expect(task.output).toMatchObject({ fileName: 'CR3657_Test_Scenarios_v1.xlsx', scenarioCount: 3, clarificationCount: 1, unverifiedCount: 1, wipApplicable: false });
    const checks = (task.output.checks as string[]).join('\n');
    expect(checks).toMatch(/points to scenario "S9", which does not exist/);
    expect(checks).toMatch(/combination 3 was marked Covered but has no scenario; shown as TBD/);
    expect(checks).toMatch(/"FR-3657-07" was marked Covered but no scenario is mapped; shown as Not Covered/);
    expect(checks).toMatch(/WIP was declared not applicable/);
    expect(checks).toMatch(/1 of 3 scenario\(s\) have a source quote that could not be found/);
  });

  it('the workbook has every sheet, consistent IDs, remapped references, and a computed summary', async () => {
    const a = (await t.app.inject({ method: 'GET', url: `/api/crs/${crId}/artifacts` })).json().find((x: { artifactType: string }) => x.artifactType === 'SCENARIOS_XLSX');
    const dl = await t.app.inject({ method: 'GET', url: `/api/artifacts/${a.id}/download` });
    expect(dl.statusCode).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(dl.rawPayload as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(Object.values(SHEETS));

    const ts = wb.getWorksheet(SHEETS.scenarios)!;
    expect([ts.getCell('A2').value, ts.getCell('A3').value, ts.getCell('A4').value]).toEqual(['CR3657-TS-001', 'CR3657-TS-002', 'CR3657-TS-003']);
    expect(ts.getCell('C2').value).toBe('frs.docx (v1) › Section "FR-3657-04 — Tender: no fully completed zone"');
    expect([ts.getCell('D2').value, ts.getCell('D4').value]).toEqual(['Yes', 'No']); // S3's quote isn't in the FRS
    expect(ts.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
    expect(ts.autoFilter).toBeTruthy();

    // Decision table: X marks per scenario column, unknown key shown as TBD
    const dt = wb.getWorksheet(SHEETS.decision)!;
    const rows = dt.getSheetValues().filter(Boolean).map((r) => (r as unknown[]).slice(1).map((v) => (v ?? '') as string));
    expect(rows[0][0]).toBe('Decision Table / Combination Matrix');
    const header = rows.find((r) => r[0] === 'Condition')!;
    expect(header).toEqual(['Condition', 'CR3657-TS-001', 'CR3657-TS-002', 'TBD 3', 'TBD 4']);
    expect(rows.find((r) => r[0] === 'Method = Tender')).toEqual(['Method = Tender', 'X', '', '', 'X']);
    expect(rows.find((r) => r[0] === 'Coverage')).toEqual(['Coverage', 'Covered', 'Covered', 'TBD', 'TBD']);

    // Requirement coverage uses final IDs; the unmapped "Covered" became Not Covered
    const rc = wb.getWorksheet(SHEETS.coverage)!;
    expect(rc.getCell('D2').value).toBe('CR3657-TS-001, CR3657-TS-003');
    expect(rc.getCell('J3').value).toBe('Not Covered');

    expect(wb.getWorksheet(SHEETS.clarification)!.getCell('A2').value).toBe('CL-001');
    expect(wb.getWorksheet(SHEETS.wip)!.getCell('B2').value).toBe('WIP / Non-WIP Transaction State: N/A based on source requirement.');
    expect(wb.getWorksheet(SHEETS.enhancement)!.getCell('E2').value).toBe('CR3657-TS-001');

    // Summary counts come from the rows, not from the model
    const sm = wb.getWorksheet(SHEETS.summary)!.getSheetValues().filter(Boolean).map((r) => (r as unknown[]).slice(1));
    const count = (label: string) => sm.find((r) => r[0] === label)?.[1];
    expect(count('Total number of scenarios')).toBe(3);
    expect(count('Negative scenarios')).toBe(1); // S1 only (S3 is a Boundary scenario)
    expect(count('Regression scenarios')).toBe(1);
    expect(count('Total Decision Table combinations')).toBe(4);
    expect(count('Covered combinations')).toBe(2);
    expect(count('TBD combinations')).toBe(2);
    expect(count('Clarification Required count')).toBe(1);
    expect(sm.some((r) => r[0] === 'WIP scenarios')).toBe(false); // WIP not applicable → not listed

    const review = wb.getWorksheet(SHEETS.review)!.getSheetValues().filter(Boolean).map((r) => (r as unknown[]).slice(1));
    expect(review.some((r) => r[0] === 'Automatic check by QA Mission Control' && String(r[1]).includes('S9'))).toBe(true);
  });

  it('a second run is a new version; the first stays downloadable', async () => {
    const r = await t.app.inject({ method: 'POST', url: `/api/crs/${crId}/generate-scenarios`, payload: {} });
    await (t.app as unknown as { qamc: { runner: { idle(): Promise<void> } } }).qamc.runner.idle();
    const out = (await t.app.inject({ method: 'GET', url: `/api/tasks/${r.json().id}` })).json().output;
    expect(out.fileName).toBe('CR3657_Test_Scenarios_v2.xlsx');
    const list = (await t.app.inject({ method: 'GET', url: `/api/crs/${crId}/artifacts` })).json();
    expect(list.filter((x: { artifactType: string }) => x.artifactType === 'SCENARIOS_XLSX')).toHaveLength(2);
  });

  it('an empty answer saves nothing', async () => {
    const empty = new ScriptedAi(() => ({ ...ANSWER, scenarios: [] }));
    const t2 = await makeTestApp({}, { ai: empty });
    try {
      const p = await t2.app.inject({ method: 'POST', url: '/api/projects', payload: { code: 'EM', name: 'Empty' } });
      const id = (await t2.app.inject({ method: 'POST', url: `/api/projects/${p.json().id}/crs`, payload: { crNumber: 'CR1', title: 'x' } })).json().id;
      await t2.app.inject({ method: 'POST', url: `/api/crs/${id}/documents`, ...multipart([{ name: 'frs.docx', content: await FRS() }]) });
      const r = await t2.app.inject({ method: 'POST', url: `/api/crs/${id}/generate-scenarios`, payload: {} });
      await (t2.app as unknown as { qamc: { runner: { idle(): Promise<void> } } }).qamc.runner.idle();
      const tk = (await t2.app.inject({ method: 'GET', url: `/api/tasks/${r.json().id}` })).json();
      expect(tk.status).toBe('FAILED');
      expect(tk.error).toMatch(/no test scenarios/);
      expect(await t2.db.generatedArtifact.count()).toBe(0);
    } finally {
      await t2.app.close();
    }
  });
});
