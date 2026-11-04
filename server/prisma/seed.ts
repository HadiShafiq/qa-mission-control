/**
 * OPTIONAL demonstration data — run with `npm run db:seed`.
 * Creates one clearly labelled demo project and CR so you can explore the UI.
 * It does NOT create requirements, scenarios, executions or evidence: those
 * must only ever come from real analysis and real test runs.
 */
import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';

config();
const db = new PrismaClient();

const existing = await db.project.findUnique({ where: { code: 'DEMO' } });
if (existing) {
  console.log('Demo project already exists — nothing to do.');
} else {
  const project = await db.project.create({
    data: {
      code: 'DEMO',
      name: 'Demo Project (sample data)',
      description: 'Sample project created by the seed script. Safe to archive.',
      environments: { create: [{ name: 'Local', type: 'LOCAL', baseUrl: 'http://localhost:3000', description: 'Example only' }] },
      changeRequests: {
        create: [{ crNumber: 'CR-DEMO-001', title: 'Sample CR — upload a real CR document to begin', version: '1.0' }],
      },
    },
  });
  await db.auditLog.create({
    data: { projectId: project.id, entityType: 'Project', entityId: project.id, action: 'CREATED', summary: 'Demo project created by seed script', actor: 'seed' },
  });
  console.log('Created demo project DEMO with CR-DEMO-001.');
}
await db.$disconnect();
