import type { Prisma, Requirement } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { REQUIREMENT_CLASSIFICATIONS, REQUIREMENT_TYPES, REVIEW_STATUSES, RISK_LEVELS } from '../domain/constants.js';
import { nextRequirementNumber, requirementCode, writeRevision } from '../domain/requirements.js';
import { audit, diff } from '../lib/audit.js';
import { conflict, notFound } from '../lib/errors.js';
import { IdParams, optionalText, parse, requiredText } from '../lib/validate.js';

const EditableFields = {
  module: optionalText(200),
  feature: optionalText(200),
  requirementType: z.enum(REQUIREMENT_TYPES).optional(),
  classification: z.enum(REQUIREMENT_CLASSIFICATIONS).optional(),
  businessRule: optionalText(2000),
  userRole: optionalText(200),
  sourceReference: optionalText(500),
  risk: z.enum(RISK_LEVELS).optional(),
};

const CreateRequirement = z.object({
  ...EditableFields,
  description: requiredText(4000, 'Requirement description'),
  // Optional evidence for manually added items. Stored as given; manual items are never marked "verified".
  sourceQuote: optionalText(1000),
  rationale: optionalText(1000),
});
const UpdateRequirement = z.object({ ...EditableFields, description: requiredText(4000, 'Requirement description').optional() });

const Review = z.object({ status: z.enum(REVIEW_STATUSES), comment: optionalText(1000) });
const BulkReview = z.object({
  ids: z.array(z.string().min(1).max(64)).min(1, 'Select at least one requirement').max(500),
  status: z.enum(REVIEW_STATUSES),
  comment: optionalText(1000),
});

const ListQuery = z.object({
  search: z.string().trim().max(100).optional(),
  reviewStatus: z.enum(REVIEW_STATUSES).optional(),
  classification: z.enum(REQUIREMENT_CLASSIFICATIONS).optional(),
});

type Tx = Prisma.TransactionClient;

export async function requirementRoutes(app: FastifyInstance, { db }: AppContext) {
  async function writableCr(crId: string) {
    const cr = await db.changeRequest.findUnique({ where: { id: crId }, include: { project: true } });
    if (!cr) throw notFound('Change request');
    if (cr.archivedAt || cr.project.archivedAt) throw conflict('Archived CRs are read-only. Restore it first.');
    return cr;
  }

  async function getRequirement(id: string) {
    const r = await db.requirement.findUnique({ where: { id }, include: { changeRequest: { include: { project: true } } } });
    if (!r) throw notFound('Requirement');
    return r;
  }

  app.get('/api/crs/:id/requirements', async (req) => {
    const { id } = parse(IdParams, req.params);
    const q = parse(ListQuery, req.query);
    if (!(await db.changeRequest.findUnique({ where: { id }, select: { id: true } }))) throw notFound('Change request');
    return db.requirement.findMany({
      where: {
        crId: id,
        ...(q.reviewStatus ? { reviewStatus: q.reviewStatus } : {}),
        ...(q.classification ? { classification: q.classification } : {}),
        ...(q.search
          ? {
              OR: [
                { requirementCode: { contains: q.search.toUpperCase() } },
                { description: { contains: q.search } },
                { module: { contains: q.search } },
                { feature: { contains: q.search } },
              ],
            }
          : {}),
      },
      orderBy: { requirementCode: 'asc' },
    });
  });

  app.post('/api/crs/:id/requirements', async (req, reply) => {
    const { id } = parse(IdParams, req.params);
    const body = parse(CreateRequirement, req.body);
    const cr = await writableCr(id);
    const created = await db.$transaction(async (tx) => {
      const n = await nextRequirementNumber(tx, cr.id, cr.crNumber);
      const r = await tx.requirement.create({ data: { ...body, crId: cr.id, requirementCode: requirementCode(cr.crNumber, n), origin: 'MANUAL' } });
      await writeRevision(tx, r, 'Added manually');
      await audit(tx, { projectId: cr.projectId, entityType: 'Requirement', entityId: r.id, action: 'CREATED', summary: `${r.requirementCode} added manually` });
      return r;
    });
    reply.code(201);
    return created;
  });

  app.get('/api/requirements/:id', async (req) => {
    const { id } = parse(IdParams, req.params);
    const { changeRequest, ...r } = await getRequirement(id);
    return { ...r, crNumber: changeRequest.crNumber };
  });

  app.get('/api/requirements/:id/revisions', async (req) => {
    const { id } = parse(IdParams, req.params);
    await getRequirement(id);
    const revs = await db.requirementRevision.findMany({ where: { requirementId: id }, orderBy: { revision: 'desc' } });
    return revs.map((r) => ({ ...r, snapshot: JSON.parse(r.snapshot) as Record<string, unknown> }));
  });

  app.patch('/api/requirements/:id', async (req) => {
    const { id } = parse(IdParams, req.params);
    const body = parse(UpdateRequirement, req.body);
    const before = await getRequirement(id);
    await writableCr(before.crId);

    const changes = diff(before, body);
    if (!Object.keys(changes).length) return stripCr(before);

    const data: Prisma.RequirementUpdateInput = { ...body, revision: before.revision + 1 };
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
      const r = await tx.requirement.update({ where: { id }, data });
      await writeRevision(tx, r, before.reviewStatus === 'APPROVED' ? 'Edited (approval reset)' : 'Edited');
      await audit(tx, {
        projectId: before.changeRequest.projectId,
        entityType: 'Requirement',
        entityId: id,
        action: 'UPDATED',
        summary: `${r.requirementCode} edited (revision ${r.revision})`,
        changes,
      });
      return r;
    });
  });

  async function review(tx: Tx, before: Requirement, projectId: string, status: (typeof REVIEW_STATUSES)[number], comment: string | null | undefined) {
    const next = { reviewStatus: status, reviewComment: comment === undefined ? before.reviewComment : comment };
    const changes = diff(before, next);
    if (!Object.keys(changes).length) return before;
    const r = await tx.requirement.update({ where: { id: before.id }, data: { ...next, revision: before.revision + 1 } });
    const label = status === 'CLARIFICATION_REQUIRED' ? 'marked clarification required' : status.toLowerCase();
    await writeRevision(tx, r, `Review: ${label}`);
    await audit(tx, {
      projectId,
      entityType: 'Requirement',
      entityId: r.id,
      action: status === 'APPROVED' ? 'APPROVED' : status === 'REJECTED' ? 'REJECTED' : 'REVIEWED',
      summary: `${r.requirementCode} ${label}`,
      changes,
    });
    return r;
  }

  app.post('/api/requirements/:id/review', async (req) => {
    const { id } = parse(IdParams, req.params);
    const body = parse(Review, req.body);
    const before = await getRequirement(id);
    await writableCr(before.crId);
    return db.$transaction((tx) => review(tx, before, before.changeRequest.projectId, body.status, body.comment));
  });

  app.post('/api/crs/:id/requirements/review', async (req) => {
    const { id } = parse(IdParams, req.params);
    const body = parse(BulkReview, req.body);
    const cr = await writableCr(id);
    const rows = await db.requirement.findMany({ where: { id: { in: body.ids }, crId: id } });
    if (rows.length !== new Set(body.ids).size) throw notFound('One or more requirements');
    const updated = await db.$transaction(async (tx) => {
      const out = [];
      for (const r of rows) out.push(await review(tx, r, cr.projectId, body.status, body.comment));
      return out;
    });
    return { updated: updated.length };
  });
}

function stripCr<T extends { changeRequest: unknown }>({ changeRequest: _c, ...r }: T) {
  return r;
}
