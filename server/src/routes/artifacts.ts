import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { AppError, notFound } from '../lib/errors.js';
import { contentDisposition } from '../lib/storage.js';
import { IdParams, parse } from '../lib/validate.js';

/** Generated files (workbooks). Creating them is done by the feature that owns them. */
export async function artifactRoutes(app: FastifyInstance, { db, storage }: AppContext) {
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
