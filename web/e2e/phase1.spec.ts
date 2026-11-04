import { expect, test, type Page } from '@playwright/test';

// One end-to-end walk through Phase 1, in order, against a fresh database.
test.describe.configure({ mode: 'serial' });

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

async function stat(page: Page, label: string) {
  return (await page.getByTestId(`stat-${label}`).textContent())?.trim();
}

test('empty dashboard shows empty states, not invented numbers', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  expect(await stat(page, 'Projects')).toBe('0');
  expect(await stat(page, 'Change requests')).toBe('0');
  await expect(page.getByText('Start by creating a project')).toBeVisible();
  await expect(page.getByText('No test cases yet').first()).toBeVisible();
  await expect(page.getByText('AI not connected')).toBeVisible();
});

test('create a project, then reject a duplicate code', async ({ page }) => {
  await page.goto('/projects');
  await page.getByRole('button', { name: 'New project' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Project code').fill('epermit');
  await expect(dlg.getByLabel('Project code')).toHaveValue('EPERMIT');
  await dlg.getByLabel('Project name').fill('ePermit Portal');
  await dlg.getByLabel('Description').fill('Permit application system');
  await dlg.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('heading', { name: /ePermit Portal/ })).toBeVisible();
  await expect(page.getByTestId('history-list')).toContainText('Project EPERMIT created');

  await page.goto('/projects');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('dialog').getByLabel('Project code').fill('EPERMIT');
  await page.getByRole('dialog').getByLabel('Project name').fill('Duplicate');
  await page.getByRole('dialog').getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('alert')).toContainText('already used');
});

test('validate and add an environment', async ({ page }) => {
  await page.goto('/projects');
  await page.getByTestId('projects-table').getByText('ePermit Portal').click();
  await page.getByRole('button', { name: 'Add environment' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Name').fill('SIT');
  await dlg.getByLabel('Base URL').fill('ftp://bad');
  // Bypass the browser's own URL check so the server validation is exercised.
  await dlg.locator('form').evaluate((f) => f.setAttribute('novalidate', ''));
  await dlg.getByRole('button', { name: 'Add environment' }).click();
  await expect(dlg.getByText(/must start with http/)).toBeVisible();
  await dlg.getByLabel('Base URL').fill('https://sit.epermit.example.my');
  await dlg.getByRole('button', { name: 'Add environment' }).click();
  await expect(page.getByTestId('env-list')).toContainText('https://sit.epermit.example.my');
});

test('create a CR, upload documents, download identical bytes', async ({ page }) => {
  await page.goto('/projects');
  await page.getByTestId('projects-table').getByText('ePermit Portal').click();
  await page.getByRole('button', { name: 'New CR' }).first().click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('CR number').fill('cr30045');
  await dlg.getByLabel('CR title').fill('Supervisor assigns pending applications');
  await dlg.getByRole('button', { name: 'Create CR' }).click();
  await expect(page.getByRole('heading', { name: /CR30045/ })).toBeVisible();

  // Upload a valid PDF
  await page.getByTestId('file-input').setInputFiles({ name: 'CR30045 FRS.pdf', mimeType: 'application/pdf', buffer: PDF });
  await expect(page.getByTestId('document-list')).toContainText('CR30045 FRS.pdf');
  await expect(page.getByTestId('document-list')).toContainText('v1');

  // Rejected client-side: wrong type
  await page.getByTestId('file-input').setInputFiles({ name: 'tool.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('MZ') });
  await expect(page.getByText('tool.exe: .exe files are not accepted')).toBeVisible();

  // Rejected server-side: content doesn't match extension
  await page.getByTestId('file-input').setInputFiles({ name: 'fake.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not a pdf') });
  await expect(page.getByText(/does not match the \.pdf extension/)).toBeVisible();

  // Re-upload creates v2
  await page.getByTestId('file-input').setInputFiles({ name: 'CR30045 FRS.pdf', mimeType: 'application/pdf', buffer: Buffer.concat([PDF, Buffer.from('v2')]) });
  await expect(page.getByTestId('document-list').getByText('v2')).toBeVisible();

  // Download v1 and compare bytes
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Download CR30045 FRS.pdf version 1' }).click()]);
  expect(download.suggestedFilename()).toBe('CR30045 FRS.pdf');
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  expect(Buffer.concat(chunks).equals(PDF)).toBe(true);

  await expect(page.getByTestId('history-list')).toContainText('Uploaded CR30045 FRS.pdf (v2)');
});

test('edit CR status and see it in review history', async ({ page }) => {
  await page.goto('/projects?tab=crs');
  await page.getByTestId('crs-table').getByText('Supervisor assigns pending applications').click();
  await page.getByRole('button', { name: 'Edit' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Version').fill('1.1');
  await dlg.getByLabel('Analysis status').selectOption('IN_PROGRESS');
  await dlg.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByTestId('history-list').first()).toContainText('analysisStatus');
  await expect(page.getByTestId('history-list').first()).toContainText('1.1');
});

test('dashboard reflects saved records', async ({ page }) => {
  await page.goto('/');
  expect(await stat(page, 'Projects')).toBe('1');
  expect(await stat(page, 'Change requests')).toBe('1');
  await expect(page.getByText('2 source documents')).toBeVisible();
  await expect(page.getByRole('link', { name: /CR30045/ })).toBeVisible();
});

test('search and filter CRs', async ({ page }) => {
  await page.goto('/projects?tab=crs');
  await page.getByLabel('Search CRs').fill('nothing-matches');
  await expect(page.getByText('No change requests match')).toBeVisible();
  await page.getByLabel('Search CRs').fill('30045');
  await expect(page.getByTestId('crs-table')).toContainText('CR30045');
  await page.getByLabel('Analysis status').selectOption('APPROVED');
  await expect(page.getByText('No change requests match')).toBeVisible();
});

test('archive and restore a project without losing data', async ({ page }) => {
  await page.goto('/projects');
  await page.getByTestId('projects-table').getByText('ePermit Portal').click();
  await page.getByRole('button', { name: 'Archive' }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Archive project' }).click();
  await expect(page.getByText('This project is archived and read-only')).toBeVisible();

  await page.goto('/');
  expect(await stat(page, 'Projects')).toBe('0');

  await page.goto('/projects');
  await expect(page.getByText('No projects match').or(page.getByText('No projects yet'))).toBeVisible();
  await page.getByRole('radio', { name: 'Archived' }).click();
  await page.getByTestId('projects-table').getByText('ePermit Portal').click();
  await page.getByRole('button', { name: 'Restore project' }).click();
  await expect(page.getByText('This project is archived')).toHaveCount(0);
  await expect(page.getByTestId('crs-table')).toContainText('CR30045');
});

test('unbuilt modules say so honestly', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: /Test Case Studio/ }).click();
  await expect(page.getByText("This module isn't built yet.")).toBeVisible();
  await expect(page.getByText('Planned for phase 4')).toBeVisible();
});

test('dark mode toggles and persists across reloads', async ({ page }) => {
  await page.goto('/settings');
  await expect(page.getByTestId('ai-status')).toContainText('Not connected');
  const isDark = () => page.evaluate(() => document.documentElement.classList.contains('dark'));
  const before = await isDark();
  await page.getByTestId('theme-toggle').click();
  expect(await isDark()).toBe(!before);
  await page.reload();
  expect(await isDark()).toBe(!before);
});

test('mobile layout opens the navigation drawer', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto('/');
  const overflow = await page.evaluate(() => document.querySelector('main')!.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
});
