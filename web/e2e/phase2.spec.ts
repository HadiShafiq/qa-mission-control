import path from 'node:path';
import ExcelJS from 'exceljs';
import { PrismaClient } from '@prisma/client';
import { expect, test, type Page } from '@playwright/test';

// CR Analysis Studio — one function: upload CR / FRS → generate QA test scenarios
// → review / approve → export Excel. The UI test server has no AI connected, so
// generation itself is covered by the API tests (scripted AI) and by the live
// runs recorded in TEST_RESULTS.md. Here one workbook is stored straight into
// the test database exactly as a generation run saves it, and the real screens
// are tested on top of it.
test.describe.configure({ mode: 'serial' });

/** Real text PDF. */
function makePdf(pages: string[][]): Buffer {
  const objs: string[] = ['<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const pagesId = 2 + pages.length * 2;
  const kids: number[] = [];
  for (const lines of pages) {
    const body = lines.map((l, i) => `BT /F1 11 Tf 72 ${740 - i * 16} Td (${l}) Tj ET`).join('\n');
    objs.push(`<< /Length ${body.length} >>\nstream\n${body}\nendstream`);
    objs.push(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Contents ${objs.length} 0 R /Resources << /Font << /F1 1 0 R >> >> >>`);
    kids.push(objs.length);
  }
  objs.push(`<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`);
  objs.push(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${objs.length} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

const PDF = makePdf([['1 Overview', 'This CR changes the permit approval flow.'], ['2 Approval', 'A supervisor approves applications over RM 5000.']]);
let crId = '';

/** Store a generated workbook the way the scenario analyst does (rows + revision 1). */
async function seedWorkbook(id: string, version: number, descriptions: string[]) {
  const db = new PrismaClient({ datasourceUrl: `file:${path.resolve(import.meta.dirname, '..', '..', '.e2e', 'e2e.db')}` });
  try {
    const j = (v: unknown) => JSON.stringify(v);
    const w = await db.scenarioWorkbook.create({
      data: {
        crId: id,
        version,
        model: 'seeded-for-ui-test',
        documents: j(['CR88001 FRS.pdf (v1)']),
        dimensions: j([]),
        wip: j({ applicable: false, statement: 'No WIP in the FRS.' }),
        enhancement: j({ applicable: false, statement: 'n/a' }),
        decisionTables: j([]),
        requirementCoverage: j([]),
        wipCoverage: j([]),
        enhancementCoverage: j([]),
        clarifications: j([]),
        selfReview: j([]),
        checks: j([]),
      },
    });
    for (const [i, d] of descriptions.entries()) {
      const s = await db.testScenario.create({
        data: {
          crId: id,
          workbookId: w.id,
          scenarioCode: `CR88001-TS-${String(i + 1).padStart(3, '0')}`,
          title: d,
          description: d,
          testType: i === 2 ? 'Boundary' : 'Positive, Business Rule',
          priority: 'HIGH',
          userRole: 'Supervisor',
          functionScreen: 'Approval',
          expectedResult: 'Application is routed to the supervisor.',
          sourceReference: 'CR88001 FRS.pdf (v1) › Page 2',
          sourceQuote: 'A supervisor approves applications over RM 5000.',
          sourceVerified: true,
          origin: 'AI',
        },
      });
      await db.scenarioRevision.create({ data: { scenarioId: s.id, revision: 1, snapshot: j({ description: d, priority: 'HIGH', reviewStatus: 'PENDING' }), changeNote: 'Generated (seeded for UI test)' } });
    }
  } finally {
    await db.$disconnect();
  }
}

async function openAnalysis(page: Page) {
  await page.goto(`/cr-analysis/${crId}`);
  await expect(page.getByRole('heading', { name: /CR88001/ })).toBeVisible();
}

test('set up a CR with a real PDF and open it from the CR page', async ({ page, request }) => {
  const p = await request.post('/api/projects', { data: { code: 'ANALYSIS', name: 'Analysis Project' } });
  const cr = await request.post(`/api/projects/${(await p.json()).id}/crs`, { data: { crNumber: 'CR88001', title: 'Approval limit change' } });
  crId = (await cr.json()).id;

  await page.goto(`/crs/${crId}`);
  await page.getByTestId('file-input').setInputFiles({ name: 'CR88001 FRS.pdf', mimeType: 'application/pdf', buffer: PDF });
  await expect(page.getByTestId('document-list')).toContainText('CR88001 FRS.pdf');
  await page.getByRole('link', { name: 'Open in CR Analysis Studio' }).click();
  await expect(page).toHaveURL(new RegExp(`/cr-analysis/${crId}$`));
});

test('one function only: no requirement extraction; without AI, generation cannot run and nothing is invented', async ({ page }) => {
  await openAnalysis(page);
  await expect(page.getByTestId('document-list')).toContainText('CR88001 FRS.pdf');
  await expect(page.getByTestId('ai-not-connected')).toContainText('AI is not connected');
  await expect(page.getByTestId('generate-scenarios')).toBeDisabled();
  await expect(page.getByTestId('scenarios-blocked')).toHaveText('AI is not connected.');
  await expect(page.getByText('No test scenarios yet')).toBeVisible();
  // the removed requirement features are not on the page
  await expect(page.getByTestId('run-analysis')).toHaveCount(0);
  await expect(page.getByText('Requirement extraction')).toHaveCount(0);
  await expect(page.getByText('Requirements workbook')).toHaveCount(0);
});

test('the extracted text preview shows page references', async ({ page }) => {
  await openAnalysis(page);
  await page.getByRole('button', { name: 'Show what the analyst reads' }).click();
  const list = page.getByTestId('extraction-list');
  await expect(list).toContainText('2 segment(s)');
  await list.getByText('CR88001 FRS.pdf').click();
  await expect(list.getByText('Page 2', { exact: true })).toBeVisible();
  await expect(list).toContainText('A supervisor approves applications over RM 5000.');
});

test('stored scenarios appear in the review table with counts and sources', async ({ page }) => {
  await seedWorkbook(crId, 1, ['Supervisor approves an application over RM 5000', 'Officer cannot approve over RM 5000', 'Application of exactly RM 5000']);
  await openAnalysis(page);
  const table = page.getByTestId('scenarios-table');
  await expect(table).toContainText('CR88001-TS-001');
  await expect(table).toContainText('CR88001-TS-003');
  await expect(table).toContainText('quote verified');
  await expect(page.getByTestId('scenario-counts')).toContainText('3 pending');
});

test('edit creates a revision you can compare, then approve', async ({ page }) => {
  await openAnalysis(page);
  await page.getByTestId('scenarios-table').getByRole('button', { name: 'CR88001-TS-001' }).click();
  const dlg = page.getByRole('dialog');
  await expect(dlg).toContainText('Revision 1');
  await dlg.getByLabel('Test Scenario Description').fill('Supervisor approves an application above RM 5000');
  await dlg.getByRole('button', { name: 'Save changes' }).click();
  await expect(dlg).toContainText('Revision 2');

  await dlg.getByRole('tab', { name: /Revisions/ }).click();
  await expect(dlg.getByTestId('revision-list')).toContainText('Edited');
  const changed = dlg.getByTestId('revision-compare').locator('tr[data-changed]');
  await expect(changed.first()).toContainText('Supervisor approves an application above RM 5000');

  await dlg.getByRole('tab', { name: 'Details' }).click();
  await dlg.getByRole('button', { name: 'Approve' }).click();
  await expect(dlg.getByText('Approved', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('scenario-counts')).toContainText('1 approved');
});

test('copy a scenario to the clipboard', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openAnalysis(page);
  await page.getByTestId('scenarios-table').getByRole('button', { name: 'CR88001-TS-001' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Copy' }).click();
  await expect(page.getByText('Copied CR88001-TS-001')).toBeVisible();
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toContain('CR88001-TS-001 — Supervisor approves an application above RM 5000');
  expect(text).toContain('Expected result: Application is routed to the supervisor.');
});

test('bulk review, filters, and adding a scenario by hand', async ({ page }) => {
  await openAnalysis(page);
  await page.getByLabel('Select CR88001-TS-003').check();
  await page.getByRole('button', { name: 'Needs clarification' }).click();
  await expect(page.getByTestId('scenario-counts')).toContainText('1 need clarification');

  await page.getByLabel('Filter by review status').selectOption('APPROVED');
  await expect(page.getByTestId('scenarios-table')).toContainText('CR88001-TS-001');
  await expect(page.getByTestId('scenarios-table')).not.toContainText('CR88001-TS-002');
  await page.getByLabel('Filter by review status').selectOption('');
  await page.getByLabel('Filter by scenario type').selectOption('Boundary');
  await expect(page.getByTestId('scenarios-table')).toContainText('CR88001-TS-003');
  await expect(page.getByTestId('scenarios-table')).not.toContainText('CR88001-TS-001');
  await page.getByLabel('Filter by scenario type').selectOption('');

  await page.getByRole('button', { name: 'Add scenario' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Test Scenario Description').fill('Supervisor rejects an application');
  await dlg.getByLabel('Expected Result').fill('Status becomes Rejected.');
  await dlg.getByRole('button', { name: 'Add scenario' }).click();
  await expect(page.getByTestId('scenarios-table')).toContainText('CR88001-TS-004');
});

test('export downloads the reviewed workbook with Review Status; approved-only has only approved rows', async ({ page }) => {
  await openAnalysis(page);
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-scenarios').click()]);
  expect(download.suggestedFilename()).toBe('CR88001_Test_Scenarios_v1.xlsx');
  const chunks: Buffer[] = [];
  for await (const c of await download.createReadStream()) chunks.push(c as Buffer);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.concat(chunks) as unknown as ArrayBuffer);
  expect(wb.worksheets.map((w) => w.name)).toEqual([
    'Test Scenarios',
    'Decision Table',
    'Requirement Coverage',
    'Clarification Required',
    'Scenario Summary',
    'WIP-Transaction Coverage',
    'Enhancement Coverage',
    'Test Dimensions',
    'QA Self-Review',
  ]);
  const ts = wb.getWorksheet('Test Scenarios')!;
  const header = (ts.getRow(1).values as unknown[]).slice(1);
  const col = (h: string) => header.indexOf(h) + 1;
  expect(ts.getCell(2, col('Test Scenario ID')).value).toBe('CR88001-TS-001');
  expect(ts.getCell(2, col('Test Scenario Description')).value).toBe('Supervisor approves an application above RM 5000');
  expect(ts.getCell(2, col('Review Status')).value).toBe('Approved');
  expect(ts.getCell(4, col('Review Status')).value).toBe('Clarification required');
  expect(ts.getCell(5, col('Test Scenario ID')).value).toBe('CR88001-TS-004');

  const [approved] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export approved only' }).click()]);
  expect(approved.suggestedFilename()).toBe('CR88001_Approved_Test_Scenarios_v1.xlsx');
  const c2: Buffer[] = [];
  for await (const c of await approved.createReadStream()) c2.push(c as Buffer);
  const wb2 = new ExcelJS.Workbook();
  await wb2.xlsx.load(Buffer.concat(c2) as unknown as ArrayBuffer);
  let rows = 0;
  wb2.getWorksheet('Test Scenarios')!.eachRow((_r, n) => n > 1 && rows++);
  expect(rows).toBe(1);
});

test('a newer run is shown by default; older runs stay selectable', async ({ page }) => {
  await seedWorkbook(crId, 2, ['Re-run scenario A', 'Re-run scenario B']);
  await openAnalysis(page);
  await expect(page.getByRole('heading', { name: 'Test scenarios (2)' })).toBeVisible();
  await page.getByLabel('Workbook version').selectOption({ index: 1 }); // Run v1 (newest is first)
  await expect(page.getByTestId('scenarios-table')).toContainText('CR88001-TS-004');
  await expect(page.getByText('You are looking at an older run.')).toBeVisible();
});

test('studio lists the CR with its scenario count; history records the review; dashboard counts the latest run', async ({ page }) => {
  await page.goto('/cr-analysis');
  const row = page.getByTestId('analysis-cr-table').getByRole('row', { name: /CR88001/ });
  await expect(row).toContainText('2'); // newest run has 2 scenarios
  await row.click();
  await expect(page).toHaveURL(new RegExp(`/cr-analysis/${crId}$`));

  await page.goto(`/crs/${crId}`);
  const history = page.getByTestId('history-list');
  await expect(history).toContainText('CR88001-TS-001 approved');
  await expect(history).toContainText('Exported CR88001_Test_Scenarios_v1.xlsx');

  await page.goto('/');
  await expect(page.getByText(/2 test scenario\(s\) need review/)).toBeVisible();
});

test('New analysis: one dialog creates the CR from the FRS filename and uploads it', async ({ page }) => {
  await page.goto('/cr-analysis');
  await page.getByTestId('new-analysis').click();
  const dlg = page.getByRole('dialog');
  await dlg.getByTestId('new-analysis-file-input').setInputFiles({ name: 'Change Request-CR3657 - Approval workflow change_V2.0.pdf', mimeType: 'application/pdf', buffer: PDF });
  await expect(dlg.getByLabel('CR number')).toHaveValue('CR3657');
  await expect(dlg.getByLabel('CR title')).toHaveValue('Approval workflow change');
  await expect(dlg.getByLabel('Version')).toHaveValue('2.0');
  await dlg.getByLabel('Project', { exact: true }).selectOption({ label: '+ New project…' });
  await dlg.getByLabel('Project code').fill('wfp');
  await dlg.getByLabel('Project name').fill('Workflow Portal');
  // no AI on the test server: generation can't be started, only the CR is created
  await expect(dlg.getByRole('checkbox', { name: /Generate test scenarios straight away/ })).toBeDisabled();
  await dlg.getByTestId('create-analysis').click();
  await expect(page.getByRole('heading', { name: /CR3657/ })).toBeVisible();
  await expect(page.getByTestId('document-list')).toContainText('Change Request-CR3657 - Approval workflow change_V2.0.pdf');

  // the same CR number again in the same project is refused with a clear message
  await page.goto('/cr-analysis');
  await page.getByTestId('new-analysis').click();
  const again = page.getByRole('dialog');
  await again.getByTestId('new-analysis-file-input').setInputFiles({ name: 'Change Request-CR3657 - Approval workflow change_V2.1.pdf', mimeType: 'application/pdf', buffer: PDF });
  await again.getByLabel('Project', { exact: true }).selectOption({ label: 'WFP — Workflow Portal' });
  await again.getByTestId('create-analysis').click();
  await expect(again.getByRole('alert')).toContainText('CR3657 already exists');
});

test('New analysis reads the CR number, title and version from inside the document', async ({ page }) => {
  await page.goto('/cr-analysis');
  await page.getByTestId('new-analysis').click();
  const dlg = page.getByRole('dialog');
  const doc = makePdf([['Change Request No: CR4100', 'Title: Bulk upload of suppliers', 'Version: 1.2']]);
  await dlg.getByTestId('new-analysis-file-input').setInputFiles({ name: 'spec.pdf', mimeType: 'application/pdf', buffer: doc });
  await expect(dlg.getByLabel('CR number')).toHaveValue('CR4100');
  await expect(dlg.getByLabel('CR title')).toHaveValue('Bulk upload of suppliers');
  await expect(dlg.getByLabel('Version')).toHaveValue('1.2');
  await expect(dlg).toContainText('Filled in from the document Page 1');
  await dlg.getByLabel('CR title').fill('My own title');
  await dlg.getByTestId('new-analysis-file-input').setInputFiles({ name: 'spec2.pdf', mimeType: 'application/pdf', buffer: doc });
  await expect(dlg.getByTestId('reading-document')).toHaveCount(0);
  await expect(dlg.getByLabel('CR title')).toHaveValue('My own title');
});

test('mobile: analysis page has no horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await openAnalysis(page);
  await expect(page.getByTestId('scenarios-table')).toBeVisible();
  const offenders = await page.evaluate(() =>
    [...document.querySelectorAll('main *')]
      .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1 && !el.closest('.overflow-x-auto'))
      .slice(0, 5)
      .map((el) => `${el.tagName}.${(el as HTMLElement).className.toString().slice(0, 60)} → ${Math.round(el.getBoundingClientRect().right)}px`),
  );
  expect(offenders).toEqual([]);
});
