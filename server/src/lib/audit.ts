import type { Prisma, PrismaClient } from '@prisma/client';

type Db = PrismaClient | Prisma.TransactionClient;

export type FieldChanges = Record<string, { from: unknown; to: unknown }>;

/** Returns only the fields whose values actually changed. */
export function diff(before: Record<string, unknown>, after: Record<string, unknown>): FieldChanges {
  const changes: FieldChanges = {};
  for (const key of Object.keys(after)) {
    if (after[key] === undefined) continue;
    const a = before[key] ?? null;
    const b = after[key] ?? null;
    if (String(a) !== String(b)) changes[key] = { from: a, to: b };
  }
  return changes;
}

export async function audit(
  db: Db,
  entry: {
    projectId?: string | null;
    entityType: string;
    entityId: string;
    action: string;
    summary: string;
    changes?: FieldChanges;
  },
) {
  await db.auditLog.create({
    data: {
      projectId: entry.projectId ?? null,
      entityType: entry.entityType,
      entityId: entry.entityId,
      action: entry.action,
      summary: entry.summary,
      changes: entry.changes && Object.keys(entry.changes).length ? JSON.stringify(entry.changes) : null,
    },
  });
}

export function parseAudit<T extends { changes: string | null }>(row: T) {
  return { ...row, changes: row.changes ? (JSON.parse(row.changes) as FieldChanges) : null };
}
