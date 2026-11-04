import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestApp, multipart, samplePdf, samplePng, sampleZip } from './helpers.js';

let t: Awaited<ReturnType<typeof makeTestApp>>;
let projectId: string;
let crId: string;

beforeAll(async () => {
  t = await makeTestApp({ MAX_UPLOAD_MB: '1' });
  projectId = (await t.app.inject({ method: 'POST', url: '/api/projects', payload: { code: 'PRJ', name: 'Project' } })).json().id;
});
afterAll(async () => {
  await t.app.close();
});

const post = (url: string, payload?: object) => t.app.inject({ method: 'POST', url, payload });
const get = (url: string) => t.app.inject({ method: 'GET', url });
const upload = (files: Parameters<typeof multipart>[0], id = crId) => {
  const m = multipart(files);
  return t.app.inject({ method: 'POST', url: `/api/crs/${id}/documents`, payload: m.payload, headers: m.headers });
};

describe('change requests', () => {
  it('creates a CR with defaults', async () => {
    const res = await post(`/api/projects/${projectId}/crs`, { crNumber: 'cr30045', title: 'Officer assignment' });
    expect(res.statusCode).toBe(201);
    const cr = res.json();
    expect(cr).toMatchObject({ crNumber: 'CR30045', version: '1.0', analysisStatus: 'NOT_STARTED', documentCount: 0 });
    crId = cr.id;
  });

  it('rejects a duplicate CR number in the same project but allows it in another', async () => {
    expect((await post(`/api/projects/${projectId}/crs`, { crNumber: 'CR30045', title: 'dup' })).statusCode).toBe(409);
    const other = (await post('/api/projects', { code: 'PRJ2', name: 'Second' })).json();
    expect((await post(`/api/projects/${other.id}/crs`, { crNumber: 'CR30045', title: 'same number' })).statusCode).toBe(201);
  });

  it('lists, searches and filters CRs', async () => {
    await post(`/api/projects/${projectId}/crs`, { crNumber: 'CR40001', title: 'Payment gateway' });
    expect((await get(`/api/crs?projectId=${projectId}`)).json()).toHaveLength(2);
    const s = (await get(`/api/crs?projectId=${projectId}&search=payment`)).json();
    expect(s.map((c: { crNumber: string }) => c.crNumber)).toEqual(['CR40001']);
    expect((await get(`/api/crs?projectId=${projectId}&analysisStatus=APPROVED`)).json()).toHaveLength(0);
  });

  it('rejects invalid status values', async () => {
    const res = await t.app.inject({ method: 'PATCH', url: `/api/crs/${crId}`, payload: { analysisStatus: 'DONE' } });
    expect(res.statusCode).toBe(400);
  });

  it('updates a CR and records review history', async () => {
    const res = await t.app.inject({ method: 'PATCH', url: `/api/crs/${crId}`, payload: { version: '1.1', analysisStatus: 'IN_PROGRESS' } });
    expect(res.statusCode).toBe(200);
    const h = (await get(`/api/crs/${crId}/history`)).json();
    expect(h[0].changes).toMatchObject({ version: { from: '1.0', to: '1.1' }, analysisStatus: { from: 'NOT_STARTED', to: 'IN_PROGRESS' } });
  });
});

describe('document upload & download', () => {
  it('uploads multiple valid files and downloads identical bytes', async () => {
    const pdf = samplePdf();
    const res = await upload([
      { name: 'CR30045 Spec.pdf', content: pdf },
      { name: 'Data.xlsx', content: sampleZip() },
      { name: 'screen.PNG', content: samplePng() },
    ]);
    expect(res.statusCode).toBe(201);
    const docs = res.json();
    expect(docs.map((d: { fileType: string }) => d.fileType)).toEqual(['PDF', 'XLSX', 'PNG']);

    const dl = await get(`/api/documents/${docs[0].id}/download`);
    expect(dl.statusCode).toBe(200);
    expect(dl.headers['content-type']).toBe('application/pdf');
    expect(dl.headers['content-disposition']).toContain('CR30045 Spec.pdf');
    expect(dl.rawPayload.equals(pdf)).toBe(true);

    const verify = (await get(`/api/documents/${docs[0].id}/verify`)).json();
    expect(verify).toEqual({ id: docs[0].id, present: true, intact: true });
    expect((await get(`/api/crs/${crId}`)).json().documentCount).toBe(3);
  });

  it('versions re-uploads of the same file name instead of overwriting', async () => {
    const res = await upload([{ name: 'CR30045 Spec.pdf', content: Buffer.concat([samplePdf(), Buffer.from('rev2')]) }]);
    const doc = res.json()[0];
    expect(doc.version).toBe(2);
    const dl = await get(`/api/documents/${doc.id}/download`);
    expect(dl.headers['content-disposition']).toContain('CR30045 Spec_v2.pdf');
    const docs = (await get(`/api/crs/${crId}/documents`)).json();
    expect(docs.filter((d: { originalName: string }) => d.originalName === 'CR30045 Spec.pdf')).toHaveLength(2);
  });

  it('rejects disallowed extensions', async () => {
    const res = await upload([{ name: 'evil.exe', content: Buffer.from('MZ') }]);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/not allowed/);
  });

  it('rejects files whose content does not match the extension', async () => {
    const res = await upload([{ name: 'fake.pdf', content: Buffer.from('this is not a pdf') }]);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/does not match/);
  });

  it('rejects empty files', async () => {
    expect((await upload([{ name: 'empty.pdf', content: Buffer.alloc(0) }])).statusCode).toBe(400);
  });

  it('rejects files over the size limit and leaves nothing on disk', async () => {
    const big = Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(1.2 * 1024 * 1024)]);
    const before = (await get(`/api/crs/${crId}/documents`)).json().length;
    const res = await upload([{ name: 'big.pdf', content: big }]);
    expect(res.statusCode).toBe(413);
    expect((await get(`/api/crs/${crId}/documents`)).json()).toHaveLength(before);
    const dir = path.join(t.config.storageDir, 'projects', projectId, 'crs', crId, 'documents');
    expect(fs.readdirSync(dir)).toHaveLength(before);
  });

  it('neutralises path traversal in file names', async () => {
    const res = await upload([{ name: '..\\..\\..\\windows\\evil.pdf', content: samplePdf() }]);
    expect(res.statusCode).toBe(201);
    const doc = res.json()[0];
    expect(doc.originalName).toBe('evil.pdf');
    expect(doc.storageKey.startsWith(`projects/${projectId}/crs/${crId}/documents/`)).toBe(true);
    expect(doc.storageKey).not.toContain('..');
  });

  it('archives a document (soft) and hides it from the default list', async () => {
    const docs = (await get(`/api/crs/${crId}/documents`)).json();
    const target = docs[0];
    expect((await post(`/api/documents/${target.id}/archive`)).statusCode).toBe(200);
    expect((await get(`/api/crs/${crId}/documents`)).json()).toHaveLength(docs.length - 1);
    expect((await get(`/api/crs/${crId}/documents?includeArchived=true`)).json()).toHaveLength(docs.length);
    // Archived files are still downloadable (history is retained)
    expect((await get(`/api/documents/${target.id}/download`)).statusCode).toBe(200);
    const h = (await get(`/api/crs/${crId}/history`)).json().map((x: { action: string }) => x.action);
    expect(h).toEqual(expect.arrayContaining(['UPLOADED', 'ARCHIVED']));
  });

  it('blocks uploads to an archived CR', async () => {
    await post(`/api/crs/${crId}/archive`);
    expect((await upload([{ name: 'x.pdf', content: samplePdf() }])).statusCode).toBe(409);
    await post(`/api/crs/${crId}/restore`);
  });

  it('returns 410 when a stored file has gone missing', async () => {
    const doc = (await upload([{ name: 'gone.pdf', content: samplePdf() }])).json()[0];
    fs.rmSync(path.join(t.config.storageDir, ...doc.storageKey.split('/')));
    expect((await get(`/api/documents/${doc.id}/download`)).statusCode).toBe(410);
  });
});

describe('dashboard', () => {
  it('computes counts from persisted records and returns null percentages without data', async () => {
    const s = (await get('/api/dashboard/summary')).json();
    expect(s.counts.totalProjects).toBe(2);
    expect(s.counts.totalCrs).toBe(3);
    expect(s.counts.requirements).toBe(0);
    expect(s.counts.testCases).toBe(0);
    expect(s.percentages).toEqual({ automationCoverage: null, executionProgress: null, evidenceCompletion: null });
    expect(s.recentActivity.length).toBeGreaterThan(0);
    expect(s.ai.configured).toBe(false);
  });

  it('counts only the latest execution per test case', async () => {
    const cr = await t.db.changeRequest.findUniqueOrThrow({ where: { id: crId } });
    const sc = await t.db.testScenario.create({ data: { crId: cr.id, scenarioCode: 'CR30045-TS-001', title: 'x', reviewStatus: 'APPROVED' } });
    const tc = await t.db.testCase.create({ data: { scenarioId: sc.id, testCaseCode: 'TC-001', description: 'x' } });
    await t.db.executionRun.create({ data: { testCaseId: tc.id, status: 'FAILED', startedAt: new Date(Date.now() - 60000) } });
    await t.db.executionRun.create({ data: { testCaseId: tc.id, status: 'PASSED' } });
    const s = (await get('/api/dashboard/summary')).json();
    expect(s.counts).toMatchObject({ testCases: 1, passed: 1, failed: 0, approvedScenarios: 1 });
    expect(s.percentages.executionProgress).toBe(100);
    expect(s.percentages.automationCoverage).toBe(0);
  });

  it('excludes archived CRs from metrics', async () => {
    await post(`/api/crs/${crId}/archive`);
    const s = (await get('/api/dashboard/summary')).json();
    expect(s.counts.totalCrs).toBe(2);
    expect(s.counts.testCases).toBe(0);
  });
});
