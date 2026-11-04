import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { CR_ANALYST } from '../agents/crAnalyst.js';
import type { AppContext } from '../context.js';
import { buildRequirementsWorkbook, validateRequirementsWorkbook, type AnalysisNotes } from '../exports/requirementsWorkbook.js';
import { audit } from '../lib/audit.js';
import { AppError, badRequest, notFound } from '../lib/errors.js';
import { contentDisposition } from '../lib/storage.js';
import { IdParams, parse } from '../lib/validate.js';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const ExportBody = z.object({ scope: z.enum(['all', 'approved']).default('all') });

export async function artifactRoutes(app: FastifyInstance, { db, storage }: AppContext) {
  app.post('/api/crs/:id/exports/requirements', async (req, reply) => {
    const { id } = parse(IdParams, req.params);
    const { scope } = parse(ExportBody, req.body);
    const cr = await db.changeRequest.findUnique({ where: { id }, include: { project: true } });
    if (!cr) throw notFound('Change request');

    const requirements = await db.requirement.findMany({
      where: { crId: id, ...(scope === 'approved' ? { reviewStatus: 'APPROVED' } : {}) },
      orderBy: { requirementCode: 'asc' },
    });
    if (!requirements.length) {
      throw badRequest(scope === 'approved' ? 'No approved requirements to export yet' : 'This CR has no requirements to export yet');
    }

    const lastAnalysis = await db.agentTask.findFirst({ where: { crId: id, agent: CR_ANALYST, status: 'COMPLETED' }, orderBy: { finishedAt: 'desc' } });
    const out = lastAnalysis?.output ? (JSON.parse(lastAnalysis.output) as Partial<AnalysisNotes>) : null;
    const notes: AnalysisNotes | null = out
      ? { crSummary: out.crSummary ?? '', impactedModules: out.impactedModules ?? [], regressionImpact: out.regressionImpact ?? [], model: lastAnalysis!.model, finishedAt: lastAnalysis!.finishedAt }
      : null;

    const name = scope === 'approved' ? `${cr.crNumber} Approved Requirements` : `${cr.crNumber} Requirements`;
    const latest = await db.generatedArtifact.findFirst({ where: { projectId: cr.projectId, name }, orderBy: { version: 'desc' } });
    const version = (latest?.version ?? 0) + 1;
    const fileName = `${name.replace(/\s+/g, '_')}_v${version}.xlsx`;

    const data = await buildRequirementsWorkbook({ project: cr.project, cr, requirements, scope, version, preparedBy: 'local-user', notes });
    const problems = await validateRequirementsWorkbook(data, requirements.length);
    if (problems.length) throw new AppError(500, 'EXPORT_INVALID', `The generated workbook failed validation: ${problems.join('; ')}`);

    const file = await storage.saveBuffer(`projects/${cr.projectId}/crs/${cr.id}/artifacts`, fileName, data);
    const artifact = await db.$transaction(async (tx) => {
      const a = await tx.generatedArtifact.create({
        data: {
          projectId: cr.projectId,
          crId: cr.id,
          artifactType: 'REQUIREMENTS_XLSX',
          name,
          version,
          fileName,
          storageKey: file.key,
          mimeType: XLSX_MIME,
          sizeBytes: file.sizeBytes,
          sha256: file.sha256,
        },
      });
      await audit(tx, {
        projectId: cr.projectId,
        entityType: 'GeneratedArtifact',
        entityId: a.id,
        action: 'GENERATED',
        summary: `Exported ${fileName} (${requirements.length} requirement(s))`,
      });
      return a;
    });
    reply.code(201);
    return artifact;
  });

  app.get('/api/crs/:id/artifacts', async (req) => {
    const { id } = parse(IdParams, req.params);
    if (!(await db.changeRequest.findUnique({ where: { id }, select: { id: true } }))) throw notFound('Change request');
    return db.generatedArtifact.findMany({ where: { crId: id }, orderBy: [{ createdAt: 'desc' }] });
  });

  app.get('/api/artifacts/:id/download', async (req, reply) => {
    const { id } = parse(IdParams, req.params);
    const a = await db.generatedArtifact.findUnique({ where: { id } });
    if (!a) throw notFound('Artifact');
    if (!(await storage.exists(a.storageKey))) throw new AppError(410, 'FILE_MISSING', 'The generated file is missing from disk. Export it again.');
    reply
      .header('Content-Type', a.mimeType)
      .header('Content-Length', a.sizeBytes)
      .header('Content-Disposition', contentDisposition(a.fileName))
      .header('X-Content-SHA256', a.sha256)
      .header('X-Content-Type-Options', 'nosniff');
    return reply.send(storage.read(a.storageKey));
  });
}
