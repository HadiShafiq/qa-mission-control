import type { AgentTask } from '@prisma/client';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CR_ANALYST, NOT_CONNECTED_MESSAGE, type AnalysisTaskInput } from '../agents/crAnalyst.js';
import { SCENARIO_ANALYST } from '../agents/scenarioAnalyst.js';
import type { AppContext } from '../context.js';
import { ACTIVE_TASK_STATUSES } from '../domain/constants.js';
import { audit } from '../lib/audit.js';
import { AppError, badRequest, conflict, notFound } from '../lib/errors.js';
import { extractDocument } from '../lib/extract.js';
import { IdParams, parse } from '../lib/validate.js';

const AnalyseBody = z.object({
  // Default: every non-archived document of the CR.
  documentIds: z.array(z.string().min(1).max(64)).max(50).optional(),
});

export function shapeTask(t: AgentTask) {
  return {
    ...t,
    input: t.input ? JSON.parse(t.input) : null,
    output: t.output ? JSON.parse(t.output) : null,
    usage: t.usage ? JSON.parse(t.usage) : null,
  };
}

export async function analysisRoutes(app: FastifyInstance, { db, storage, ai, runner }: AppContext) {
  /**
   * Preview of the text the analyst will read, with the reference labels it
   * will cite. Works without an API key, so extraction can be checked first.
   */
  app.get('/api/crs/:id/extraction', async (req) => {
    const { id } = parse(IdParams, req.params);
    const cr = await db.changeRequest.findUnique({ where: { id } });
    if (!cr) throw notFound('Change request');
    const docs = await db.sourceDocument.findMany({ where: { crId: id, archivedAt: null }, orderBy: [{ originalName: 'asc' }, { version: 'desc' }] });
    const out = [];
    for (const d of docs) {
      const base = { documentId: d.id, name: d.originalName, version: d.version, fileType: d.fileType };
      if (!(await storage.exists(d.storageKey))) {
        out.push({ ...base, segments: [], charCount: 0, warnings: ['The stored file is missing from disk.'], notes: [], image: false, images: [] });
        continue;
      }
      const x = await extractDocument(await storage.readBuffer(d.storageKey), d.fileType);
      const images = x.images.map(({ data: _d, ...meta }) => meta);
      out.push({ ...base, segments: x.segments, charCount: x.charCount, warnings: x.warnings, notes: x.notes, image: Boolean(x.image), images });
    }
    return out;
  });

  /** One picture embedded in a document (for the extraction preview). */
  app.get('/api/documents/:id/images/:n', async (req, reply) => {
    const { id, n } = parse(z.object({ id: z.string().min(1).max(64), n: z.coerce.number().int().min(1).max(10_000) }), req.params);
    const doc = await db.sourceDocument.findUnique({ where: { id } });
    if (!doc) throw notFound('Document');
    if (!(await storage.exists(doc.storageKey))) throw new AppError(410, 'FILE_MISSING', 'The stored file is missing from disk.');
    const pic = (await extractDocument(await storage.readBuffer(doc.storageKey), doc.fileType)).images.find((p) => p.n === n);
    if (!pic) throw notFound('Picture');
    reply.header('Content-Type', pic.mediaType).header('Cache-Control', 'private, max-age=300').header('X-Content-Type-Options', 'nosniff');
    return reply.send(pic.data);
  });

  // Both CR agents start the same way: checks, a persisted QUEUED task, then the runner.
  const startTask = (agent: string, taskType: string, label: string) => async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = parse(IdParams, req.params);
    const body = parse(AnalyseBody, req.body);
    const cr = await db.changeRequest.findUnique({ where: { id }, include: { project: true } });
    if (!cr) throw notFound('Change request');
    if (cr.archivedAt || cr.project.archivedAt) throw conflict('Archived CRs are read-only. Restore it first.');
    if (!ai) throw new AppError(409, 'AI_NOT_CONNECTED', NOT_CONNECTED_MESSAGE);

    const docs = await db.sourceDocument.findMany({
      where: { crId: id, archivedAt: null, ...(body.documentIds ? { id: { in: body.documentIds } } : {}) },
      select: { id: true },
    });
    if (body.documentIds && docs.length !== new Set(body.documentIds).size) throw badRequest('Some selected documents do not belong to this CR or are archived');
    if (!docs.length) throw badRequest(`Upload at least one CR document before starting the ${label}`);

    const running = await db.agentTask.findFirst({ where: { crId: id, agent, status: { in: [...ACTIVE_TASK_STATUSES] } } });
    if (running) throw conflict(`A ${label} is already running for this CR`);

    const input: AnalysisTaskInput = { documentIds: docs.map((d) => d.id) };
    const task = await db.$transaction(async (tx) => {
      const t = await tx.agentTask.create({
        data: { projectId: cr.projectId, crId: id, agent, taskType, model: ai.model, input: JSON.stringify(input), progressMessage: 'Queued' },
      });
      await audit(tx, { projectId: cr.projectId, entityType: 'AgentTask', entityId: t.id, action: 'CREATED', summary: `${label[0].toUpperCase()}${label.slice(1)} queued for ${cr.crNumber} (${docs.length} document(s))` });
      return t;
    });
    runner.enqueue(task.id);
    reply.code(202);
    return shapeTask(task);
  };

  app.post('/api/crs/:id/analyse', startTask(CR_ANALYST, 'REQUIREMENT_EXTRACTION', 'requirement analysis'));
  app.post('/api/crs/:id/generate-scenarios', startTask(SCENARIO_ANALYST, 'TEST_SCENARIO_WORKBOOK', 'test scenario generation'));

  app.get('/api/crs/:id/tasks', async (req) => {
    const { id } = parse(IdParams, req.params);
    const tasks = await db.agentTask.findMany({ where: { crId: id }, orderBy: { createdAt: 'desc' }, take: 50 });
    return tasks.map(shapeTask);
  });

  app.get('/api/tasks/:id', async (req) => {
    const { id } = parse(IdParams, req.params);
    const t = await db.agentTask.findUnique({ where: { id } });
    if (!t) throw notFound('Task');
    return shapeTask(t);
  });

  app.post('/api/tasks/:id/cancel', async (req) => {
    const { id } = parse(IdParams, req.params);
    const t = await db.agentTask.findUnique({ where: { id } });
    if (!t) throw notFound('Task');
    if (!(await runner.cancel(id))) throw conflict(`The task has already finished (${t.status.toLowerCase()})`);
    return shapeTask(await db.agentTask.findUniqueOrThrow({ where: { id } }));
  });
}
