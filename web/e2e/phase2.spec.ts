import ExcelJS from 'exceljs';
import { expect, test, type Page } from '@playwright/test';

// Phase 2 — CR Analysis, as a user without an Anthropic API key (the e2e server
// runs with ANTHROPIC_API_KEY empty). The AI path itself is covered by the API
// tests with a scripted client; here we check the UI never pretends AI ran and
// that manual review, revisions and export all work.
test.describe.configure({ mode: 'serial' });

/** Real two-page text PDF. */
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
  await page.getByRole('link', { name: 'Analyse requirements' }).click();
  await expect(page).toHaveURL(new RegExp(`/cr-analysis/${crId}$`));
});

test('without an API key the page says AI is not connected and the analysis cannot run', async ({ page }) => {
  await openAnalysis(page);
  // documents can be uploaded and listed right here, not only on the CR page
  await expect(page.getByTestId('document-list')).toContainText('CR88001 FRS.pdf');
  await expect(page.getByRole('button', { name: 'Choose files' })).toBeVisible();
  await expect(page.getByTestId('ai-not-connected')).toContainText('AI is not connected');
  await expect(page.getByTestId('run-analysis')).toBeDisabled();
  await expect(page.getByTestId('generate-scenarios')).toBeDisabled();
  await expect(page.getByTestId('scenarios-blocked')).toHaveText('AI is not connected.');
  await expect(page.getByTestId('analysis-blocked')).toHaveText('AI is not connected.');
  await expect(page.getByTestId('analysis-task')).toHaveCount(0);
  await expect(page.getByText('No requirements yet')).toBeVisible();
});

test('the extracted text preview shows page references', async ({ page }) => {
  await openAnalysis(page);
  await page.getByRole('button', { name: 'Show what the analyst reads' }).click();
  const list = page.getByTestId('extraction-list');
  await expect(list).toContainText('CR88001 FRS.pdf');
  await expect(list).toContainText('2 segment(s)');
  await list.getByText('CR88001 FRS.pdf').click();
  await expect(list.getByText('Page 2', { exact: true })).toBeVisible();
  await expect(list).toContainText('A supervisor approves applications over RM 5000.');
});

test('add requirements by hand, with validation', async ({ page }) => {
  await openAnalysis(page);
  await page.getByRole('button', { name: 'Add requirement' }).click();
  let dlg = page.getByRole('dialog');
  await dlg.getByLabel('Requirement description').fill('Applications over RM 5000 must be approved by a supervisor.');
  await dlg.getByLabel('Module').fill('Permits');
  await dlg.getByLabel('Risk').selectOption('HIGH');
  await dlg.getByLabel('Source reference').fill('CR88001 FRS.pdf › Page 2');
  await dlg.getByRole('button', { name: 'Add requirement' }).click();
  await expect(page.getByTestId('requirements-table')).toContainText('CR88001-REQ-001');

  await page.getByRole('button', { name: 'Add requirement' }).click();
  dlg = page.getByRole('dialog');
  await dlg.getByLabel('Requirement description').fill('What happens to an application of exactly RM 5000?');
  await dlg.getByLabel('Classification').selectOption('CLARIFICATION_REQUIRED');
  await dlg.getByRole('button', { name: 'Add requirement' }).click();
  await expect(page.getByTestId('requirements-table')).toContainText('CR88001-REQ-002');
  await expect(page.getByTestId('requirement-counts')).toContainText('2 pending');
});

test('edit creates a revision you can compare, then approve', async ({ page }) => {
  await openAnalysis(page);
  await page.getByTestId('requirements-table').getByRole('button', { name: 'CR88001-REQ-001' }).click();
  const dlg = page.getByRole('dialog');
  await expect(dlg).toContainText('Revision 1');
  await dlg.getByLabel('Requirement description').fill('Applications above RM 5000 need supervisor approval.');
  await dlg.getByRole('button', { name: 'Save changes' }).click();
  await expect(dlg).toContainText('Revision 2');

  await dlg.getByRole('tab', { name: /Revisions/ }).click();
  await expect(dlg.getByTestId('revision-list')).toContainText('Edited');
  const changed = dlg.getByTestId('revision-compare').locator('tr[data-changed]');
  await expect(changed).toHaveCount(1);
  await expect(changed).toContainText('Applications over RM 5000 must be approved by a supervisor.');
  await expect(changed).toContainText('Applications above RM 5000 need supervisor approval.');

  await dlg.getByRole('tab', { name: 'Details' }).click();
  await dlg.getByRole('button', { name: 'Approve' }).click();
  await expect(dlg.getByText('Approved', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('requirement-counts')).toContainText('1 approved');
});

test('copy a requirement to the clipboard', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openAnalysis(page);
  await page.getByTestId('requirements-table').getByRole('button', { name: 'CR88001-REQ-001' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Copy' }).click();
  await expect(page.getByText('Copied CR88001-REQ-001')).toBeVisible();
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toContain('CR88001-REQ-001 — Applications above RM 5000 need supervisor approval.');
  expect(text).toContain('Status: Approved');
});

test('bulk review and filters', async ({ page }) => {
  await openAnalysis(page);
  await page.getByLabel('Select CR88001-REQ-002').check();
  await page.getByRole('button', { name: 'Needs clarification' }).click();
  await expect(page.getByTestId('requirement-counts')).toContainText('1 need clarification');

  await page.getByLabel('Filter by review status').selectOption('APPROVED');
  await expect(page.getByTestId('requirements-table')).toContainText('CR88001-REQ-001');
  await expect(page.getByTestId('requirements-table')).not.toContainText('CR88001-REQ-002');
  await page.getByLabel('Filter by review status').selectOption('');
  await page.getByLabel('Search requirements').fill('exactly');
  await expect(page.getByTestId('requirements-table')).toContainText('CR88001-REQ-002');
  await expect(page.getByTestId('requirements-table')).not.toContainText('CR88001-REQ-001');
});

test('export downloads a valid, editable requirements workbook', async ({ page }) => {
  await openAnalysis(page);
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-all').click()]);
  expect(download.suggestedFilename()).toBe('CR88001_Requirements_v1.xlsx');
  const chunks: Buffer[] = [];
  for await (const c of await download.createReadStream()) chunks.push(c as Buffer);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.concat(chunks) as unknown as ArrayBuffer);
  expect(wb.worksheets.map((w) => w.name)).toEqual(['Information', 'Requirements']);
  const ws = wb.getWorksheet('Requirements')!;
  expect(ws.getCell('A2').value).toBe('CR88001-REQ-001');
  expect(ws.getCell('E2').value).toBe('Applications above RM 5000 need supervisor approval.');
  expect(ws.getCell('N2').value).toBe('Approved');
  expect(ws.getCell('N3').value).toBe('Clarification required');
  await expect(page.getByTestId('artifact-list')).toContainText('CR88001_Requirements_v1.xlsx');

  // a second export is a new version, the first stays downloadable
  const [second] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-all').click()]);
  expect(second.suggestedFilename()).toBe('CR88001_Requirements_v2.xlsx');
  await expect(page.getByTestId('artifact-list').locator('li')).toHaveCount(2);
});

test('studio lists the CR, history records the work, dashboard counts pending reviews', async ({ page }) => {
  await page.goto('/cr-analysis');
  await page.getByTestId('analysis-cr-table').getByText('CR88001').click();
  await expect(page).toHaveURL(new RegExp(`/cr-analysis/${crId}$`));

  await page.goto(`/crs/${crId}`);
  const history = page.getByTestId('history-list');
  await expect(history).toContainText('CR88001-REQ-001 approved');
  await expect(history).toContainText('Exported CR88001_Requirements_v1.xlsx');

  await page.goto('/');
  await expect(page.getByText(/1 item\(s\) need review/)).toBeVisible();
});

test('New analysis: one dialog creates the CR from the FRS filename, uploads it, and IDs use that CR number', async ({ page }) => {
  await page.goto('/cr-analysis');
  await page.getByTestId('new-analysis').click();
  const dlg = page.getByRole('dialog');
  await dlg.getByTestId('new-analysis-file-input').setInputFiles({ name: 'Change Request-CR3657 - Approval workflow change_V2.0.pdf', mimeType: 'application/pdf', buffer: PDF });
  // suggested from the filename, still editable
  await expect(dlg.getByLabel('CR number')).toHaveValue('CR3657');
  await expect(dlg.getByLabel('CR title')).toHaveValue('Approval workflow change');
  await expect(dlg.getByLabel('Version')).toHaveValue('2.0');
  await dlg.getByLabel('Project', { exact: true }).selectOption({ label: '+ New project…' });
  await dlg.getByLabel('Project code').fill('wfp');
  await dlg.getByLabel('Project name').fill('Workflow Portal');
  // no AI on the test server: analysis can't be started, only the CR is created
  await expect(dlg.getByRole('checkbox', { name: /Start the analysis/ })).toBeDisabled();
  await dlg.getByTestId('create-analysis').click();

  await expect(page.getByRole('heading', { name: /CR3657/ })).toBeVisible();
  await expect(page.getByTestId('document-list')).toContainText('Change Request-CR3657 - Approval workflow change_V2.0.pdf');
  await page.getByRole('button', { name: 'Add requirement' }).click();
  await page.getByRole('dialog').getByLabel('Requirement description').fill('Approvals route to the supervisor.');
  await page.getByRole('dialog').getByRole('button', { name: 'Add requirement' }).click();
  await expect(page.getByTestId('requirements-table')).toContainText('CR3657-REQ-001');

  // the same CR number again in the same project is refused with a clear message
  await page.goto('/cr-analysis');
  await expect(page.getByTestId('analysis-cr-table')).toContainText('CR3657');
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

  // a value the user typed is never overwritten by picking another file
  await dlg.getByLabel('CR title').fill('My own title');
  await dlg.getByTestId('new-analysis-file-input').setInputFiles({ name: 'spec2.pdf', mimeType: 'application/pdf', buffer: doc });
  await expect(dlg.getByTestId('reading-document')).toHaveCount(0);
  await expect(dlg.getByLabel('CR title')).toHaveValue('My own title');
  await expect(dlg.getByLabel('CR number')).toHaveValue('CR4100');
});

test('mobile: analysis page has no horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await openAnalysis(page);
  await expect(page.getByTestId('requirements-table')).toBeVisible();
  // List any element that sticks out past the viewport, so a failure says what overflowed.
  const offenders = await page.evaluate(() =>
    [...document.querySelectorAll('main *')]
      .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1 && !el.closest('.overflow-x-auto'))
      .slice(0, 5)
      .map((el) => `${el.tagName}.${(el as HTMLElement).className.toString().slice(0, 60)} → ${Math.round(el.getBoundingClientRect().right)}px`),
  );
  expect(offenders).toEqual([]);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
