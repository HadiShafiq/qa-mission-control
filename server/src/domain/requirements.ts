import type { Prisma, Requirement } from '@prisma/client';

type Db = Prisma.TransactionClient;

/** Fields captured in every RequirementRevision snapshot (and compared in the UI). */
export const SNAPSHOT_FIELDS = [
  'module',
  'feature',
  'description',
  'requirementType',
  'classification',
  'businessRule',
  'userRole',
  'sourceReference',
  'sourceQuote',
  'sourceVerified',
  'risk',
  'reviewStatus',
  'reviewComment',
] as const;

export type RequirementSnapshot = Pick<Requirement, (typeof SNAPSHOT_FIELDS)[number]>;

export function snapshotOf(r: Requirement): RequirementSnapshot {
  return Object.fromEntries(SNAPSHOT_FIELDS.map((f) => [f, r[f]])) as RequirementSnapshot;
}

/** `CR30045` + 7 → `CR30045-REQ-007`. Codes are never reused, even after rejection. */
export function requirementCode(crNumber: string, n: number) {
  return `${crNumber}-REQ-${String(n).padStart(3, '0')}`;
}

export async function nextRequirementNumber(tx: Db, crId: string, crNumber: string) {
  const codes = await tx.requirement.findMany({ where: { crId }, select: { requirementCode: true } });
  const prefix = `${crNumber}-REQ-`;
  let max = 0;
  for (const { requirementCode: c } of codes) {
    if (!c.startsWith(prefix)) continue;
    const n = Number(c.slice(prefix.length));
    if (Number.isInteger(n) && n > max) max = n;
  }
  return max + 1;
}

export async function writeRevision(tx: Db, r: Requirement, changeNote: string) {
  await tx.requirementRevision.create({
    data: { requirementId: r.id, revision: r.revision, snapshot: JSON.stringify(snapshotOf(r)), changeNote },
  });
}
