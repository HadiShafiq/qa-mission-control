import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestApp } from './helpers.js';

let t: Awaited<ReturnType<typeof makeTestApp>>;
beforeAll(async () => {
  t = await makeTestApp();
});
afterAll(async () => {
  await t.app.close();
});

const post = (url: string, payload?: object) => t.app.inject({ method: 'POST', url, payload });
const get = (url: string) => t.app.inject({ method: 'GET', url });

describe('health & settings', () => {
  it('reports database and storage healthy', async () => {
    const res = await get('/api/health');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', checks: { database: true, storage: true } });
  });

  it('reports AI as not connected without leaking any key', async () => {
    const res = await get('/api/settings');
    expect(res.json().ai.configured).toBe(false);
    expect(res.body).not.toMatch(/sk-ant/);
  });

  it('never returns the API key even when one is configured', async () => {
    const t2 = await makeTestApp({ ANTHROPIC_API_KEY: 'sk-ant-test-secret-value' });
    const res = await t2.app.inject({ method: 'GET', url: '/api/settings' });
    expect(res.json().ai.configured).toBe(true);
    expect(res.body).not.toContain('sk-ant-test-secret-value');
    await t2.app.close();
  });

  it('returns JSON 404 for unknown API routes', async () => {
    const res = await get('/api/nope');
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });
});

describe('projects', () => {
  let projectId: string;

  it('creates a project, normalising the code to upper case', async () => {
    const res = await post('/api/projects', { code: 'myapp', name: '  MyApp Portal ', description: 'Main portal' });
    expect(res.statusCode).toBe(201);
    const p = res.json();
    expect(p).toMatchObject({ code: 'MYAPP', name: 'MyApp Portal', archivedAt: null });
    projectId = p.id;
  });

  it('rejects duplicate project codes', async () => {
    const res = await post('/api/projects', { code: 'MYAPP', name: 'Again' });
    expect(res.statusCode).toBe(409);
  });

  it('validates required fields with field-level messages', async () => {
    const res = await post('/api/projects', { code: 'x', name: '' });
    expect(res.statusCode).toBe(400);
    const fields = res.json().error.details.map((d: { field: string }) => d.field);
    expect(fields).toEqual(expect.arrayContaining(['code', 'name']));
  });

  it('lists and searches projects', async () => {
    await post('/api/projects', { code: 'OTHER', name: 'Other System' });
    const all = (await get('/api/projects')).json();
    expect(all.map((p: { code: string }) => p.code)).toEqual(expect.arrayContaining(['MYAPP', 'OTHER']));
    const found = (await get('/api/projects?search=portal')).json();
    expect(found).toHaveLength(1);
    expect(found[0].code).toBe('MYAPP');
  });

  it('updates a project and records the field changes in history', async () => {
    const res = await t.app.inject({ method: 'PATCH', url: `/api/projects/${projectId}`, payload: { name: 'MyApp Portal v2' } });
    expect(res.statusCode).toBe(200);
    const history = (await get(`/api/projects/${projectId}/history`)).json();
    const update = history.find((h: { action: string }) => h.action === 'UPDATED');
    expect(update.changes).toEqual({ name: { from: 'MyApp Portal', to: 'MyApp Portal v2' } });
  });

  it('does not write history when nothing changed', async () => {
    const before = (await get(`/api/projects/${projectId}/history`)).json().length;
    await t.app.inject({ method: 'PATCH', url: `/api/projects/${projectId}`, payload: { name: 'MyApp Portal v2' } });
    expect((await get(`/api/projects/${projectId}/history`)).json()).toHaveLength(before);
  });

  it('manages environment configurations with URL validation', async () => {
    const bad = await post(`/api/projects/${projectId}/environments`, { name: 'SIT', type: 'SIT', baseUrl: 'javascript:alert(1)' });
    expect(bad.statusCode).toBe(400);
    const ok = await post(`/api/projects/${projectId}/environments`, { name: 'SIT', type: 'SIT', baseUrl: 'https://sit.example.com' });
    expect(ok.statusCode).toBe(201);
    const dup = await post(`/api/projects/${projectId}/environments`, { name: 'SIT', type: 'SIT', baseUrl: 'https://sit2.example.com' });
    expect(dup.statusCode).toBe(409);
    const archive = await post(`/api/environments/${ok.json().id}/archive`);
    expect(archive.statusCode).toBe(200);
    // Name can be reused after archiving
    const again = await post(`/api/projects/${projectId}/environments`, { name: 'SIT', type: 'SIT', baseUrl: 'https://sit3.example.com' });
    expect(again.statusCode).toBe(201);
    const project = (await get(`/api/projects/${projectId}`)).json();
    expect(project.environments).toHaveLength(1);
  });

  it('archives and restores without deleting data', async () => {
    const a = await post(`/api/projects/${projectId}/archive`);
    expect(a.json().archivedAt).not.toBeNull();
    expect((await get('/api/projects')).json().some((p: { id: string }) => p.id === projectId)).toBe(false);
    expect((await get('/api/projects?status=archived')).json().some((p: { id: string }) => p.id === projectId)).toBe(true);

    const edit = await t.app.inject({ method: 'PATCH', url: `/api/projects/${projectId}`, payload: { name: 'blocked' } });
    expect(edit.statusCode).toBe(409);
    const cr = await post(`/api/projects/${projectId}/crs`, { crNumber: 'CR1', title: 'x' });
    expect(cr.statusCode).toBe(409);

    const r = await post(`/api/projects/${projectId}/restore`);
    expect(r.json().archivedAt).toBeNull();
    const actions = (await get(`/api/projects/${projectId}/history`)).json().map((h: { action: string }) => h.action);
    expect(actions).toEqual(expect.arrayContaining(['CREATED', 'UPDATED', 'ARCHIVED', 'RESTORED']));
  });

  it('returns 404 for a missing project', async () => {
    expect((await get('/api/projects/does-not-exist')).statusCode).toBe(404);
  });
});
