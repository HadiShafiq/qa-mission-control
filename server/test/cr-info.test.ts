import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { detectCrInfo } from '../src/lib/crInfo.js';
import { extractDocument } from '../src/lib/extract.js';
import { makeDocx, makePdf } from './fixtures.js';
import { makeTestApp, multipart } from './helpers.js';

describe('CR number / title detection from the uploaded document', () => {
  it('reads a Word CR form like FL30753: number from "CRF No.", prefix and title from the filename', async () => {
    const docx = await makeDocx([{ table: [['A. Project Name :', 'eP-FL', 'CRF No. :', 'Redmine #30753'], ['Date Raised :', '14 April 2021']] }]);
    const info = detectCrInfo(await extractDocument(docx, 'DOCX'), 'Change Request-FL30753 - Checking PR Threshold_V1.8.docx');
    expect(info.crNumber).toEqual({ value: 'FL30753', source: 'document Table 1: "CRF No. : Redmine #30753" (prefix from the filename)' });
    expect(info.title).toMatchObject({ value: 'Checking PR Threshold', source: expect.stringMatching(/^filename/) });
    expect(info.version).toMatchObject({ value: '1.8', source: expect.stringMatching(/^filename/) });
    expect(info.projectName).toMatchObject({ value: 'eP-FL', source: 'document Table 1: "A. Project Name :"' });
  });

  it('prefers labelled title and version in the document over the filename', async () => {
    const docx = await makeDocx([{ table: [['CR No.', 'CR3657'], ['CR Title :', 'Supervisor approval limits'], ['Document Version :', 'v2.3']] }]);
    const info = detectCrInfo(await extractDocument(docx, 'DOCX'), 'Change Request-CR9999 - Old name_V1.0.docx');
    expect(info.crNumber?.value).toBe('CR3657'); // the document wins; the filename number differs
    expect(info.title).toMatchObject({ value: 'Supervisor approval limits', source: expect.stringMatching(/^document/) });
    expect(info.version).toMatchObject({ value: '2.3', source: expect.stringMatching(/^document/) });
  });

  it('reads "Label: value" lines in a PDF', async () => {
    const pdf = makePdf([['Change Request No: CR4100', 'Title: Bulk upload of suppliers', 'Version: 1.2']]);
    const info = detectCrInfo(await extractDocument(pdf, 'PDF'), 'spec.pdf');
    expect(info.crNumber).toMatchObject({ value: 'CR4100', source: expect.stringMatching(/^document Page 1/) });
    expect(info.title?.value).toBe('Bulk upload of suppliers');
    expect(info.version?.value).toBe('1.2');
  });

  it('falls back to the filename, and returns nothing rather than guessing', async () => {
    const plainPdf = await extractDocument(makePdf([['Some text without labels']]), 'PDF');
    expect(detectCrInfo(plainPdf, 'Change Request-CR3657 - Approval workflow change_V2.0.pdf')).toMatchObject({
      crNumber: { value: 'CR3657' },
      title: { value: 'Approval workflow change' },
      version: { value: '2.0' },
      projectName: null,
    });
    expect(detectCrInfo(plainPdf, 'notes.pdf')).toEqual({ crNumber: null, title: null, version: null, projectName: null });
  });
});

describe('POST /api/documents/inspect', () => {
  let t: Awaited<ReturnType<typeof makeTestApp>>;
  beforeAll(async () => (t = await makeTestApp()));
  afterAll(() => t.app.close());

  it('returns suggestions, matches an existing project, and stores nothing', async () => {
    await t.app.inject({ method: 'POST', url: '/api/projects', payload: { code: 'EPFL', name: 'eP-FL Fulfilment' } });
    const docx = await makeDocx([{ table: [['A. Project Name :', 'eP-FL', 'CRF No. :', 'Redmine #30753']] }]);
    const r = await t.app.inject({ method: 'POST', url: '/api/documents/inspect', ...multipart([{ name: 'Change Request-FL30753 - Threshold_V1.8.docx', content: docx, field: 'file' }]) });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ crNumber: { value: 'FL30753' }, title: { value: 'Threshold' }, version: { value: '1.8' }, projectName: { value: 'eP-FL' } });
    const epfl = await t.db.project.findUniqueOrThrow({ where: { code: 'EPFL' } });
    expect(r.json().matchedProjectId).toBe(epfl.id);

    expect(await t.db.sourceDocument.count()).toBe(0);
    expect(await t.db.auditLog.count({ where: { action: 'UPLOADED' } })).toBe(0);
    const tmp = path.join(t.config.storageDir, 'tmp', 'inspect');
    expect(fs.existsSync(tmp) ? fs.readdirSync(tmp) : []).toEqual([]);
  });

  it('applies the same file checks as uploads', async () => {
    const exe = await t.app.inject({ method: 'POST', url: '/api/documents/inspect', ...multipart([{ name: 'tool.exe', content: Buffer.from('MZ') }]) });
    expect(exe.statusCode).toBe(400);
    const fake = await t.app.inject({ method: 'POST', url: '/api/documents/inspect', ...multipart([{ name: 'fake.pdf', content: Buffer.from('not a pdf') }]) });
    expect(fake.statusCode).toBe(400);
    expect(fake.json().error.message).toMatch(/does not match/);
  });
});
