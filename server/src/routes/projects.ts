import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { ENVIRONMENT_TYPES } from '../domain/constants.js';
import { audit, diff, parseAudit } from '../lib/audit.js';
import { conflict, notFound } from '../lib/errors.js';
import { IdParams, ListQuery, archivedFilter, optionalText, parse, requiredText } from '../lib/validate.js';

const ProjectCode = z
  .string({ message: 'Project code is required' })
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9_-]{1,29}$/, 'Project code must be 2–30 characters: letters, numbers, - or _');

const CreateProject = z.object({
  code: ProjectCode,
  name: requiredText(120, 'Project name'),
  description: optionalText(2000),
});

const UpdateProject = z.object({
  name: requiredText(120, 'Project name').optional(),
  description: optionalText(2000),
});

const HttpUrl = z
  .string()
  .trim()
  .url('Base URL must be a valid URL')
  .refine((u) => /^https?:\/\//i.test(u), 'Base URL must start with http:// or https://');

const CreateEnvironment = z.object({
  name: requiredText(40, 'Environment name'),
  type: z.enum(ENVIRONMENT_TYPES),
  baseUrl: HttpUrl,
  description: optionalText(500),
});

const UpdateEnvironment = CreateEnvironment.partial();

export async function projectRoutes(app: FastifyInstance, { db }: AppContext) {
  async function getProject(id: string) {
    const project = await db.project.findUnique({ where: { id } });
    if (!project) throw notFound('Project');
    return project;
  }

  app.get('/api/projects', async (req) => {
    const q = parse(ListQuery, req.query);
    const projects = await db.project.findMany({
      where: {
        ...archivedFilter(q.status),
        ...(q.search ? { OR: [{ name: { contains: q.search } }, { code: { contains: q.search.toUpperCase() } }] } : {}),
      },
      orderBy: { updatedAt: 'desc' },
      include: {
        _count: { select: { changeRequests: { where: { archivedAt: null } }, environments: { where: { archivedAt: null } } } },
      },
    });
    return projects.map(({ _count, ...p }) => ({ ...p, crCount: _count.changeRequests, environmentCount: _count.environments }));
  });

  app.post('/api/projects', async (req, reply) => {
    const body = parse(CreateProject, req.body);
    if (await db.project.findUnique({ where: { code: body.code } })) {
      throw conflict(`Project code "${body.code}" is already used`);
    }
    const project = await db.$transaction(async (tx) => {
      const p = await tx.project.create({ data: body });
      await audit(tx, { projectId: p.id, entityType: 'Project', entityId: p.id, action: 'CREATED', summary: `Project ${p.code} created` });
      return p;
    });
    reply.code(201);
    return project;
  });

  app.get('/api/projects/:id', async (req) => {
    const { id } = parse(IdParams, req.params);
    const project = await db.project.findUnique({
      where: { id },
      include: {
        environments: { where: { archivedAt: null }, orderBy: { name: 'asc' } },
        _count: { select: { changeRequests: { where: { archivedAt: null } } } },
      },
    });
    if (!project) throw notFound('Project');
    const { _count, ...rest } = project;
    return { ...rest, crCount: _count.changeRequests };
  });

  app.patch('/api/projects/:id', async (req) => {
    const { id } = parse(IdParams, req.params);
    const body = parse(UpdateProject, req.body);
    const before = await getProject(id);
    if (before.archivedAt) throw conflict('Archived projects are read-only. Restore it first.');
    const changes = diff(before, body);
    if (!Object.keys(changes).length) return before;
    return db.$transaction(async (tx) => {
      const p = await tx.project.update({ where: { id }, data: body });
      await audit(tx, { projectId: id, entityType: 'Project', entityId: id, action: 'UPDATED', summary: `Project ${p.code} updated`, changes });
      return p;
    });
  });

  for (const action of ['archive', 'restore'] as const) {
    app.post(`/api/projects/:id/${action}`, async (req) => {
      const { id } = parse(IdParams, req.params);
      const before = await getProject(id);
      if (action === 'archive' && before.archivedAt) return before;
      if (action === 'restore' && !before.archivedAt) return before;
      return db.$transaction(async (tx) => {
        const p = await tx.project.update({ where: { id }, data: { archivedAt: action === 'archive' ? new Date() : null } });
        await audit(tx, {
          projectId: id,
          entityType: 'Project',
          entityId: id,
          action: action === 'archive' ? 'ARCHIVED' : 'RESTORED',
          summary: `Project ${p.code} ${action === 'archive' ? 'archived' : 'restored'}`,
        });
        return p;
      });
    });
  }

  app.get('/api/projects/:id/history', async (req) => {
    const { id } = parse(IdParams, req.params);
    await getProject(id);
    const rows = await db.auditLog.findMany({ where: { projectId: id }, orderBy: { createdAt: 'desc' }, take: 200 });
    return rows.map(parseAudit);
  });

  // ───────── Environment configurations ─────────

  app.get('/api/projects/:id/environments', async (req) => {
    const { id } = parse(IdParams, req.params);
    await getProject(id);
    return db.environmentConfiguration.findMany({ where: { projectId: id, archivedAt: null }, orderBy: { name: 'asc' } });
  });

  app.post('/api/projects/:id/environments', async (req, reply) => {
    const { id } = parse(IdParams, req.params);
    const body = parse(CreateEnvironment, req.body);
    const project = await getProject(id);
    if (project.archivedAt) throw conflict('Cannot add environments to an archived project');
    const existing = await db.environmentConfiguration.findUnique({ where: { projectId_name: { projectId: id, name: body.name } } });
    if (existing) throw conflict(`Environment "${body.name}" already exists in this project`);
    const env = await db.$transaction(async (tx) => {
      const e = await tx.environmentConfiguration.create({ data: { ...body, projectId: id } });
      await audit(tx, { projectId: id, entityType: 'EnvironmentConfiguration', entityId: e.id, action: 'CREATED', summary: `Environment ${e.name} added (${e.baseUrl})` });
      return e;
    });
    reply.code(201);
    return env;
  });

  app.patch('/api/environments/:id', async (req) => {
    const { id } = parse(IdParams, req.params);
    const body = parse(UpdateEnvironment, req.body);
    const before = await db.environmentConfiguration.findUnique({ where: { id } });
    if (!before) throw notFound('Environment');
    if (body.name && body.name !== before.name) {
      const clash = await db.environmentConfiguration.findUnique({ where: { projectId_name: { projectId: before.projectId, name: body.name } } });
      if (clash) throw conflict(`Environment "${body.name}" already exists in this project`);
    }
    const changes = diff(before, body);
    if (!Object.keys(changes).length) return before;
    return db.$transaction(async (tx) => {
      const e = await tx.environmentConfiguration.update({ where: { id }, data: body });
      await audit(tx, { projectId: e.projectId, entityType: 'EnvironmentConfiguration', entityId: id, action: 'UPDATED', summary: `Environment ${e.name} updated`, changes });
      return e;
    });
  });

  app.post('/api/environments/:id/archive', async (req) => {
    const { id } = parse(IdParams, req.params);
    const before = await db.environmentConfiguration.findUnique({ where: { id } });
    if (!before) throw notFound('Environment');
    if (before.archivedAt) return before;
    return db.$transaction(async (tx) => {
      // Rename on archive so the name can be reused by a new environment.
      const e = await tx.environmentConfiguration.update({
        where: { id },
        data: { archivedAt: new Date(), name: `${before.name} (archived ${Date.now()})` },
      });
      await audit(tx, { projectId: e.projectId, entityType: 'EnvironmentConfiguration', entityId: id, action: 'ARCHIVED', summary: `Environment ${before.name} archived` });
      return e;
    });
  });
}
