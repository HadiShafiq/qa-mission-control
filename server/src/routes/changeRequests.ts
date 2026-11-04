import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { ANALYSIS_STATUSES, PROGRESS_STATUSES } from '../domain/constants.js';
import { latestWorkbookIds } from '../domain/scenarios.js';
import { audit, diff, parseAudit } from '../lib/audit.js';
import { conflict, notFound } from '../lib/errors.js';
import { IdParams, archivedFilter, optionalText, parse, requiredText } from '../lib/validate.js';

const CrNumber = z
  .string({ message: 'CR number is required' })
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9_-]{1,39}$/, 'CR number must be 2–40 characters: letters, numbers, - or _');

const Version = z.string().trim().min(1, 'Version is required').max(20).regex(/^[\w.\-]+$/, 'Version may contain letters, numbers, dots and dashes');

const CreateCr = z.object({
  crNumber: CrNumber,
  title: requiredText(200, 'CR title'),
  description: optionalText(5000),
  version: Version.default('1.0'),
});

const UpdateCr = z.object({
  title: requiredText(200, 'CR title').optional(),
  description: optionalText(5000),
  version: Version.optional(),
  analysisStatus: z.enum(ANALYSIS_STATUSES).optional(),
  automationStatus: z.enum(PROGRESS_STATUSES).optional(),
  evidenceStatus: z.enum(PROGRESS_STATUSES).optional(),
});

const CrListQuery = z.object({
  projectId: z.string().max(64).optional(),
  search: z.string().trim().max(100).optional(),
  status: z.enum(['active', 'archived', 'all']).default('active'),
  analysisStatus: z.enum(ANALYSIS_STATUSES).optional(),
});

const crInclude = {
  project: { select: { id: true, code: true, name: true, archivedAt: true } },
  _count: {
    select: {
      documents: { where: { archivedAt: null } },
      requirements: true,
      scenarios: true,
    },
  },
} as const;

type CrWithCount = { _count: { documents: number; requirements: number; scenarios: number } };
function shape<T extends CrWithCount>({ _count, ...cr }: T) {
  return { ...cr, documentCount: _count.documents, requirementCount: _count.requirements, scenarioCount: _count.scenarios };
}

export async function changeRequestRoutes(app: FastifyInstance, { db }: AppContext) {
  /** scenarioCount = scenarios in each CR's newest workbook (older runs are kept but not counted). */
  async function withScenarioCounts<T extends { id: string; scenarioCount: number }>(crs: T[]) {
    const latest = await latestWorkbookIds(db, crs.map((c) => c.id));
    const ids = [...latest.values()];
    const counts = ids.length ? await db.testScenario.groupBy({ by: ['workbookId'], where: { workbookId: { in: ids } }, _count: true }) : [];
    return crs.map((c) => ({ ...c, scenarioCount: counts.find((x) => x.workbookId === latest.get(c.id))?._count ?? 0 }));
  }

  async function getCr(id: string) {
    const cr = await db.changeRequest.findUnique({ where: { id }, include: { project: true } });
    if (!cr) throw notFound('Change request');
    return cr;
  }

  app.get('/api/crs', async (req) => {
    const q = parse(CrListQuery, req.query);
    const crs = await db.changeRequest.findMany({
      where: {
        ...archivedFilter(q.status),
        ...(q.projectId ? { projectId: q.projectId } : { project: { archivedAt: null } }),
        ...(q.analysisStatus ? { analysisStatus: q.analysisStatus } : {}),
        ...(q.search ? { OR: [{ crNumber: { contains: q.search.toUpperCase() } }, { title: { contains: q.search } }] } : {}),
      },
      orderBy: { updatedAt: 'desc' },
      include: crInclude,
    });
    return withScenarioCounts(crs.map(shape));
  });

  app.post('/api/projects/:id/crs', async (req, reply) => {
    const { id: projectId } = parse(IdParams, req.params);
    const body = parse(CreateCr, req.body);
    const project = await db.project.findUnique({ where: { id: projectId } });
    if (!project) throw notFound('Project');
    if (project.archivedAt) throw conflict('Cannot add CRs to an archived project');
    const clash = await db.changeRequest.findUnique({ where: { projectId_crNumber: { projectId, crNumber: body.crNumber } } });
    if (clash) throw conflict(`CR ${body.crNumber} already exists in project ${project.code}`);

    const cr = await db.$transaction(async (tx) => {
      const c = await tx.changeRequest.create({ data: { ...body, projectId }, include: crInclude });
      await audit(tx, { projectId, entityType: 'ChangeRequest', entityId: c.id, action: 'CREATED', summary: `CR ${c.crNumber} created` });
      await tx.project.update({ where: { id: projectId }, data: { updatedAt: new Date() } });
      return c;
    });
    reply.code(201);
    return shape(cr);
  });

  app.get('/api/crs/:id', async (req) => {
    const { id } = parse(IdParams, req.params);
    const cr = await db.changeRequest.findUnique({ where: { id }, include: crInclude });
    if (!cr) throw notFound('Change request');
    return (await withScenarioCounts([shape(cr)]))[0];
  });

  app.patch('/api/crs/:id', async (req) => {
    const { id } = parse(IdParams, req.params);
    const body = parse(UpdateCr, req.body);
    const before = await getCr(id);
    if (before.archivedAt || before.project.archivedAt) throw conflict('Archived CRs are read-only. Restore it first.');
    const changes = diff(before, body);
    if (!Object.keys(changes).length) return shape(await db.changeRequest.findUniqueOrThrow({ where: { id }, include: crInclude }));
    const updated = await db.$transaction(async (tx) => {
      const c = await tx.changeRequest.update({ where: { id }, data: body, include: crInclude });
      await audit(tx, { projectId: c.projectId, entityType: 'ChangeRequest', entityId: id, action: 'UPDATED', summary: `CR ${c.crNumber} updated`, changes });
      return c;
    });
    return shape(updated);
  });

  for (const action of ['archive', 'restore'] as const) {
    app.post(`/api/crs/:id/${action}`, async (req) => {
      const { id } = parse(IdParams, req.params);
      const before = await getCr(id);
      if (action === 'restore' && before.project.archivedAt) throw conflict('Restore the project first');
      if ((action === 'archive') === Boolean(before.archivedAt)) {
        return shape(await db.changeRequest.findUniqueOrThrow({ where: { id }, include: crInclude }));
      }
      const updated = await db.$transaction(async (tx) => {
        const c = await tx.changeRequest.update({
          where: { id },
          data: { archivedAt: action === 'archive' ? new Date() : null },
          include: crInclude,
        });
        await audit(tx, {
          projectId: c.projectId,
          entityType: 'ChangeRequest',
          entityId: id,
          action: action === 'archive' ? 'ARCHIVED' : 'RESTORED',
          summary: `CR ${c.crNumber} ${action === 'archive' ? 'archived' : 'restored'}`,
        });
        return c;
      });
      return shape(updated);
    });
  }

  // Review history: the CR itself plus its documents, requirements, agent tasks and exports.
  app.get('/api/crs/:id/history', async (req) => {
    const { id } = parse(IdParams, req.params);
    await getCr(id);
    const ids = async (rows: Promise<{ id: string }[]>) => (await rows).map((r) => r.id);
    const [docIds, reqIds, taskIds, artifactIds, scenarioIds, workbookIds] = await Promise.all([
      ids(db.sourceDocument.findMany({ where: { crId: id }, select: { id: true } })),
      ids(db.requirement.findMany({ where: { crId: id }, select: { id: true } })),
      ids(db.agentTask.findMany({ where: { crId: id }, select: { id: true } })),
      ids(db.generatedArtifact.findMany({ where: { crId: id }, select: { id: true } })),
      ids(db.testScenario.findMany({ where: { crId: id }, select: { id: true } })),
      ids(db.scenarioWorkbook.findMany({ where: { crId: id }, select: { id: true } })),
    ]);
    const rows = await db.auditLog.findMany({
      where: {
        OR: [
          { entityType: 'ChangeRequest', entityId: id },
          ...(docIds.length ? [{ entityType: 'SourceDocument', entityId: { in: docIds } }] : []),
          ...(reqIds.length ? [{ entityType: 'Requirement', entityId: { in: reqIds } }] : []),
          ...(taskIds.length ? [{ entityType: 'AgentTask', entityId: { in: taskIds } }] : []),
          ...(artifactIds.length ? [{ entityType: 'GeneratedArtifact', entityId: { in: artifactIds } }] : []),
          ...(scenarioIds.length ? [{ entityType: 'TestScenario', entityId: { in: scenarioIds } }] : []),
          ...(workbookIds.length ? [{ entityType: 'ScenarioWorkbook', entityId: { in: workbookIds } }] : []),
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 300,
    });
    return rows.map(parseAudit);
  });
}
