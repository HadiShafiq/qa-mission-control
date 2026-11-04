import type { Prisma, TestScenario } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { REVIEW_STATUSES, SCENARIO_TYPES } from '../domain/constants.js';
import { workbookSheets, writeScenarioRevision } from '../domain/scenarios.js';
import { saveScenarioExport } from '../exports/scenarioWorkbook.js';
import { audit, diff } from '../lib/audit.js';
import { conflict, notFound } from '../lib/errors.js';
import { IdParams, optionalText, parse, requiredText } from '../lib/validate.js';

const PRIORITIES = ['HIGH', 'MEDIUM', 'LOW'] as const;

const Editable = {
  requirementRef: optionalText(300),
  module: optionalText(200),
  functionScreen: optionalText(200),
  testType: z
    .array(z.enum(SCENARIO_TYPES))
    .max(SCENARIO_TYPES.length)
    .transform((t) => t.join(', '))
    .optional(),
  enhancementState: optionalText(200),
  transactionState: optionalText(200),
  workflowStatus: optionalText(200),
  userRole: optionalText(200),
  businessCondition: optionalText(2000),
  existingValue: optionalText(2000),
  actionChange: optionalText(2000),
  confirmation: optionalText(500),
  testData: optionalText(4000),
  expectedResult: optionalText(4000),
  priority: z.enum(PRIORITIES).optional(),
  regression: z.boolean().optional(),
  remarks: optionalText(2000),
  sourceReference: optionalText(500),
};
const UpdateScenario = z.object({ ...Editable, description: requiredText(4000, 'Test scenario description').optional() });
const CreateScenario = z.object({ ...Editable, description: requiredText(4000, 'Test scenario description') });
const Review = z.object({ status: z.enum(REVIEW_STATUSES), comment: optionalText(1000) });
const BulkReview = z.object({ ids: z.array(z.string().min(1).max(64)).min(1, 'Select at least one scenario').max(1000), status: z.enum(REVIEW_STATUSES), comment: optionalText(1000) });
const ListQuery = z.object({
  workbookId: z.string().max(64).optional(),
  reviewStatus: z.enum(REVIEW_STATUSES).optional(),
  type: z.enum(SCENARIO_TYPES).optional(),
  search: z.string().trim().max(100).optional(),
});
const ExportBody = z.object({ scope: z.enum(['all', 'approved']).default('all') });

type Tx = Prisma.TransactionClient;

export async function scenarioRoutes(app: FastifyInstance, { db, storage }: AppContext) {
  async function writableCr(crId: string) {
    const cr = await db.changeRequest.findUnique({ where: { id: crId }, include: { project: true } });
    if (!cr) throw notFound('Change request');
    if (cr.archivedAt || cr.project.archivedAt) throw conflict('Archived CRs are read-only. Restore it first.');
    return cr;
  }
  async function getScenario(id: string) {
    const s = await db.testScenario.findUnique({ where: { id }, include: { changeRequest: { include: { project: true } } } });
    if (!s) throw notFound('Test scenario');
    return s;
  }
  async function getWorkbook(id: string) {
    const w = await db.scenarioWorkbook.findUnique({ where: { id } });
    if (!w) throw notFound('Scenario workbook');
    return w;
  }

  /** Every generated workbook version of a CR, newest first, with review counts. */
  app.get('/api/crs/:id/scenario-workbooks', async (req) => {
    const { id } = parse(IdParams, req.params);
    const list = await db.scenarioWorkbook.findMany({ where: { crId: id }, orderBy: { version: 'desc' } });
    const counts = await db.testScenario.groupBy({ by: ['workbookId', 'reviewStatus'], where: { crId: id }, _count: true });
    return list.map((w) => {
      const c = counts.filter((x) => x.workbookId === w.id);
      const n = (s?: string) => c.filter((x) => !s || x.reviewStatus === s).reduce((a, x) => a + x._count, 0);
      return { id: w.id, version: w.version, model: w.model, createdAt: w.createdAt, scenarioCount: n(), approvedCount: n('APPROVED'), pendingCount: n('PENDING') };
    });
  });

  /** The other sheets of a workbook: dimensions, decision tables, coverage, clarifications, checks. */
  app.get('/api/scenario-workbooks/:id', async (req) => {
    const { id } = parse(IdParams, req.params);
    const w = await getWorkbook(id);
    return { id: w.id, crId: w.crId, version: w.version, model: w.model, createdAt: w.createdAt, ...workbookSheets(w) };
  });

  /** Scenarios of one workbook (default: the newest). */
  app.get('/api/crs/:id/scenarios', async (req) => {
    const { id } = parse(IdParams, req.params);
    const q = parse(ListQuery, req.query);
    const workbook = q.workbookId
      ? await db.scenarioWorkbook.findFirst({ where: { id: q.workbookId, crId: id } })
      : await db.scenarioWorkbook.findFirst({ where: { crId: id }, orderBy: { version: 'desc' } });
    if (!workbook) return { workbook: null, scenarios: [] };
    const scenarios = await db.testScenario.findMany({
      where: {
        workbookId: workbook.id,
        ...(q.reviewStatus ? { reviewStatus: q.reviewStatus } : {}),
        ...(q.type ? { testType: { contains: q.type } } : {}),
        ...(q.search
          ? {
              OR: [
                { scenarioCode: { contains: q.search.toUpperCase() } },
                { description: { contains: q.search } },
                { expectedResult: { contains: q.search } },
                { functionScreen: { contains: q.search } },
                { requirementRef: { contains: q.search } },
              ],
            }
          : {}),
      },
      orderBy: { scenarioCode: 'asc' },
    });
    return { workbook: { id: workbook.id, version: workbook.version, model: workbook.model, createdAt: workbook.createdAt }, scenarios };
  });

  app.post('/api/scenario-workbooks/:id/scenarios', async (req, reply) => {
    const { id } = parse(IdParams, req.params);
    const body = parse(CreateScenario, req.body);
    const w = await getWorkbook(id);
    const cr = await writableCr(w.crId);
    const created = await db.$transaction(async (tx) => {
      const codes = await tx.testScenario.findMany({ where: { workbookId: id }, select: { scenarioCode: true } });
      const prefix = `${cr.crNumber}-TS-`;
      const next = Math.max(0, ...codes.map((c) => Number(c.scenarioCode.slice(prefix.length)) || 0)) + 1;
      const s = await tx.testScenario.create({
        data: { ...body, crId: cr.id, workbookId: id, scenarioCode: `${prefix}${String(next).padStart(3, '0')}`, title: body.description.slice(0, 200), origin: 'MANUAL' },
      });
      await writeScenarioRevision(tx, s, 'Added manually');
      await audit(tx, { projectId: cr.projectId, entityType: 'TestScenario', entityId: s.id, action: 'CREATED', summary: `${s.scenarioCode} added manually` });
      return s;
    });
    reply.code(201);
    return created;
  });

  app.get('/api/scenarios/:id', async (req) => {
    const { id } = parse(IdParams, req.params);
    const { changeRequest, ...s } = await getScenario(id);
    return { ...s, crNumber: changeRequest.crNumber };
  });

  app.get('/api/scenarios/:id/revisions', async (req) => {
    const { id } = parse(IdParams, req.params);
    await getScenario(id);
    const revs = await db.scenarioRevision.findMany({ where: { scenarioId: id }, orderBy: { revision: 'desc' } });
    return revs.map((r) => ({ ...r, snapshot: JSON.parse(r.snapshot) as Record<string, unknown> }));
  });

  app.patch('/api/scenarios/:id', async (req) => {
    const { id } = parse(IdParams, req.params);
    const body = parse(UpdateScenario, req.body);
    const before = await getScenario(id);
    await writableCr(before.crId);
    const changes = diff(before, body);
    const { changeRequest: _cr, ...plain } = before;
    if (!Object.keys(changes).length) return plain;

    const data: Prisma.TestScenarioUpdateInput = { ...body, revision: before.revision + 1, ...(body.description ? { title: body.description.slice(0, 200) } : {}) };
    // A hand-edited reference is no longer the one the server verified.
    if (changes.sourceReference) {
      data.sourceVerified = false;
      if (before.sourceVerified) changes.sourceVerified = { from: true, to: false };
    }
    // Approved content that changes needs approving again.
    if (before.reviewStatus === 'APPROVED') {
      data.reviewStatus = 'PENDING';
      changes.reviewStatus = { from: 'APPROVED', to: 'PENDING' };
    }
    return db.$transaction(async (tx) => {
      const s = await tx.testScenario.update({ where: { id }, data });
      await writeScenarioRevision(tx, s, before.reviewStatus === 'APPROVED' ? 'Edited (approval reset)' : 'Edited');
      await audit(tx, { projectId: before.changeRequest.projectId, entityType: 'TestScenario', entityId: id, action: 'UPDATED', summary: `${s.scenarioCode} edited (revision ${s.revision})`, changes });
      return s;
    });
  });

  async function review(tx: Tx, before: TestScenario, projectId: string, status: (typeof REVIEW_STATUSES)[number], comment: string | null | undefined) {
    const next = { reviewStatus: status, reviewComment: comment === undefined ? before.reviewComment : comment };
    const changes = diff(before, next);
    if (!Object.keys(changes).length) return before;
    const s = await tx.testScenario.update({ where: { id: before.id }, data: { ...next, revision: before.revision + 1 } });
    const label = status === 'CLARIFICATION_REQUIRED' ? 'marked clarification required' : status.toLowerCase();
    await writeScenarioRevision(tx, s, `Review: ${label}`);
    await audit(tx, {
      projectId,
      entityType: 'TestScenario',
      entityId: s.id,
      action: status === 'APPROVED' ? 'APPROVED' : status === 'REJECTED' ? 'REJECTED' : 'REVIEWED',
      summary: `${s.scenarioCode} ${label}`,
      changes,
    });
    return s;
  }

  app.post('/api/scenarios/:id/review', async (req) => {
    const { id } = parse(IdParams, req.params);
    const body = parse(Review, req.body);
    const before = await getScenario(id);
    await writableCr(before.crId);
    const { changeRequest, ...row } = before;
    return db.$transaction((tx) => review(tx, row, changeRequest.projectId, body.status, body.comment));
  });

  app.post('/api/scenario-workbooks/:id/review', async (req) => {
    const { id } = parse(IdParams, req.params);
    const body = parse(BulkReview, req.body);
    const w = await getWorkbook(id);
    const cr = await writableCr(w.crId);
    const rows = await db.testScenario.findMany({ where: { id: { in: body.ids }, workbookId: id } });
    if (rows.length !== new Set(body.ids).size) throw notFound('One or more test scenarios');
    const updated = await db.$transaction(
      async (tx) => {
        let n = 0;
        for (const r of rows) if ((await review(tx, r, cr.projectId, body.status, body.comment)) !== r) n++;
        return n;
      },
      { timeout: 120_000 },
    );
    return { updated };
  });

  /** Excel built from the stored rows, so it includes every edit and review decision. */
  app.post('/api/scenario-workbooks/:id/export', async (req, reply) => {
    const { id } = parse(IdParams, req.params);
    const { scope } = parse(ExportBody, req.body);
    const w = await getWorkbook(id);
    const n = await db.testScenario.count({ where: { workbookId: id, ...(scope === 'approved' ? { reviewStatus: 'APPROVED' } : {}) } });
    if (!n) throw conflict(scope === 'approved' ? 'No approved test scenarios to export yet' : 'This workbook has no test scenarios');
    const artifact = await saveScenarioExport({ db, storage }, w.id, scope);
    reply.code(201);
    return artifact;
  });
}
