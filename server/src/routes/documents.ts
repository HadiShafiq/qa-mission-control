import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { audit } from '../lib/audit.js';
import { AppError, badRequest, conflict, notFound } from '../lib/errors.js';
import { detectCrInfo } from '../lib/crInfo.js';
import { extractDocument } from '../lib/extract.js';
import { ALLOWED_EXTENSIONS, contentDisposition } from '../lib/storage.js';
import { IdParams, parse } from '../lib/validate.js';

const DocListQuery = z.object({ includeArchived: z.enum(['true', 'false']).default('false') });

export async function documentRoutes(app: FastifyInstance, { db, storage, config }: AppContext) {
  app.get('/api/upload-rules', async () => ({
    allowedExtensions: ALLOWED_EXTENSIONS,
    maxUploadBytes: config.maxUploadBytes,
  }));

  /**
   * Read one uploaded CR/FRS and suggest CR number, title, version and project
   * for the "New analysis" form. The file is validated like any upload, read
   * from a temporary location and deleted; nothing is stored or recorded.
   */
  app.post('/api/documents/inspect', async (req) => {
    if (!req.isMultipart()) throw badRequest('Expected multipart/form-data with one file');
    const part = await req.file();
    if (!part) throw badRequest('No file was received');
    const file = await storage.saveUpload('tmp/inspect', part.filename, part.file, config.maxUploadBytes);
    try {
      const extraction = await extractDocument(await storage.readBuffer(file.key), file.fileType);
      const info = detectCrInfo(extraction, file.safeName);
      const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
      const projects = await db.project.findMany({ where: { archivedAt: null }, select: { id: true, code: true, name: true } });
      const wanted = info.projectName ? norm(info.projectName.value) : '';
      const match = wanted ? projects.find((p) => norm(p.code) === wanted || norm(p.name) === wanted || norm(p.name).startsWith(wanted)) : undefined;
      return { fileName: file.safeName, ...info, matchedProjectId: match?.id ?? null, warnings: extraction.warnings };
    } finally {
      await storage.removeTemp(file.key);
    }
  });

  app.get('/api/crs/:id/documents', async (req) => {
    const { id } = parse(IdParams, req.params);
    const q = parse(DocListQuery, req.query);
    const cr = await db.changeRequest.findUnique({ where: { id } });
    if (!cr) throw notFound('Change request');
    return db.sourceDocument.findMany({
      where: { crId: id, ...(q.includeArchived === 'true' ? {} : { archivedAt: null }) },
      orderBy: [{ originalName: 'asc' }, { version: 'desc' }],
    });
  });

  /**
   * Multipart upload — one or more files in field "files".
   * Each file is validated (extension, magic bytes, size) before a database
   * record is written. If any file fails, files already saved in this request
   * are kept (each is an independent record) and the error is reported.
   */
  app.post('/api/crs/:id/documents', async (req, reply) => {
    const { id } = parse(IdParams, req.params);
    const cr = await db.changeRequest.findUnique({ where: { id }, include: { project: true } });
    if (!cr) throw notFound('Change request');
    if (cr.archivedAt || cr.project.archivedAt) throw conflict('Cannot upload to an archived CR');
    if (!req.isMultipart()) throw badRequest('Expected multipart/form-data with one or more files');

    const saved = [];
    for await (const part of req.files()) {
      const file = await storage.saveUpload(`projects/${cr.projectId}/crs/${cr.id}/documents`, part.filename, part.file, config.maxUploadBytes);
      const doc = await db.$transaction(async (tx) => {
        const latest = await tx.sourceDocument.findFirst({
          where: { crId: id, originalName: file.safeName },
          orderBy: { version: 'desc' },
        });
        const d = await tx.sourceDocument.create({
          data: {
            crId: id,
            originalName: file.safeName,
            storedName: file.storedName,
            storageKey: file.key,
            mimeType: file.mimeType,
            fileType: file.fileType,
            sizeBytes: file.sizeBytes,
            sha256: file.sha256,
            version: (latest?.version ?? 0) + 1,
          },
        });
        await audit(tx, {
          projectId: cr.projectId,
          entityType: 'SourceDocument',
          entityId: d.id,
          action: 'UPLOADED',
          summary: `Uploaded ${d.originalName} (v${d.version}) to ${cr.crNumber}`,
        });
        return d;
      });
      saved.push(doc);
    }
    if (!saved.length) throw badRequest('No files were received');
    await db.changeRequest.update({ where: { id }, data: { updatedAt: new Date() } });
    reply.code(201);
    return saved;
  });

  app.get('/api/documents/:id/download', async (req, reply) => {
    const { id } = parse(IdParams, req.params);
    const doc = await db.sourceDocument.findUnique({ where: { id } });
    if (!doc) throw notFound('Document');
    if (!(await storage.exists(doc.storageKey))) {
      throw new AppError(410, 'FILE_MISSING', 'The stored file is missing from disk. Check STORAGE_DIR or restore from backup.');
    }
    reply
      .header('Content-Type', doc.mimeType)
      .header('Content-Length', doc.sizeBytes)
      .header('Content-Disposition', contentDisposition(versionedName(doc.originalName, doc.version)))
      .header('X-Content-SHA256', doc.sha256)
      .header('X-Content-Type-Options', 'nosniff');
    return reply.send(storage.read(doc.storageKey));
  });

  app.get('/api/documents/:id/verify', async (req) => {
    const { id } = parse(IdParams, req.params);
    const doc = await db.sourceDocument.findUnique({ where: { id } });
    if (!doc) throw notFound('Document');
    const present = await storage.exists(doc.storageKey);
    return { id, present, intact: present ? await storage.verify(doc.storageKey, doc.sha256) : false };
  });

  for (const action of ['archive', 'restore'] as const) {
    app.post(`/api/documents/:id/${action}`, async (req) => {
      const { id } = parse(IdParams, req.params);
      const doc = await db.sourceDocument.findUnique({ where: { id }, include: { changeRequest: true } });
      if (!doc) throw notFound('Document');
      if ((action === 'archive') === Boolean(doc.archivedAt)) return doc;
      return db.$transaction(async (tx) => {
        const d = await tx.sourceDocument.update({ where: { id }, data: { archivedAt: action === 'archive' ? new Date() : null } });
        await audit(tx, {
          projectId: doc.changeRequest.projectId,
          entityType: 'SourceDocument',
          entityId: id,
          action: action === 'archive' ? 'ARCHIVED' : 'RESTORED',
          summary: `${action === 'archive' ? 'Archived' : 'Restored'} ${doc.originalName} (v${doc.version})`,
        });
        return d;
      });
    });
  }
}

/** "CR Spec.pdf", v2 → "CR Spec_v2.pdf" (v1 keeps the original name). */
export function versionedName(name: string, version: number) {
  if (version <= 1) return name;
  const dot = name.lastIndexOf('.');
  return dot > 0 ? `${name.slice(0, dot)}_v${version}${name.slice(dot)}` : `${name}_v${version}`;
}
