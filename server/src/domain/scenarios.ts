import type { Prisma, PrismaClient, ScenarioWorkbook, TestScenario } from '@prisma/client';
import { summarise, type CheckedWorkbook, type Scenario } from '../agents/scenarioAnalyst.js';
import { SCENARIO_TYPES } from './constants.js';

type Db = PrismaClient | Prisma.TransactionClient;

/** Fields captured in every ScenarioRevision snapshot (and compared in the UI). */
export const SNAPSHOT_FIELDS = [
  'requirementRef',
  'module',
  'functionScreen',
  'testType',
  'enhancementState',
  'transactionState',
  'workflowStatus',
  'userRole',
  'businessCondition',
  'existingValue',
  'actionChange',
  'confirmation',
  'testData',
  'description',
  'expectedResult',
  'priority',
  'regression',
  'remarks',
  'sourceReference',
  'reviewStatus',
  'reviewComment',
] as const;

export function snapshotOf(s: TestScenario) {
  return Object.fromEntries(SNAPSHOT_FIELDS.map((f) => [f, s[f]]));
}

export async function writeScenarioRevision(tx: Db, s: TestScenario, changeNote: string) {
  // Skill-format scenarios snapshot their steps (module-adaptive columns) plus the review decision.
  const snapshot = s.steps !== null ? { steps: JSON.parse(s.steps) as unknown, reviewStatus: s.reviewStatus, reviewComment: s.reviewComment } : snapshotOf(s);
  await tx.scenarioRevision.create({ data: { scenarioId: s.id, revision: s.revision, snapshot: JSON.stringify(snapshot), changeNote } });
}

const PRIORITY_LABEL: Record<string, Scenario['priority']> = { HIGH: 'High', MEDIUM: 'Medium', LOW: 'Low' };
const TYPES = new Set<string>(SCENARIO_TYPES);

/** Workbook scenario (from the analyst) → database row fields. */
export function scenarioToRow(s: Scenario) {
  return {
    scenarioCode: s.id,
    title: s.description.slice(0, 200) || s.id,
    description: s.description,
    testType: s.types.join(', '),
    priority: s.priority.toUpperCase(),
    userRole: s.role,
    requirementRef: s.requirementRef,
    module: s.module,
    functionScreen: s.functionScreen,
    enhancementState: s.enhancementState,
    transactionState: s.transactionState,
    workflowStatus: s.status,
    businessCondition: s.businessCondition,
    existingValue: s.existingValue,
    actionChange: s.actionChange,
    confirmation: s.confirmation,
    testData: s.testData,
    expectedResult: s.expectedResult,
    regression: s.regression,
    remarks: s.remarks,
    sourceReference: s.sourceReference,
    sourceQuote: s.sourceQuote,
    sourceVerified: s.sourceVerified,
  };
}

/** Database row → workbook scenario, including the current review decision. */
export function rowToScenario(r: TestScenario): Scenario {
  return {
    id: r.scenarioCode,
    requirementRef: r.requirementRef ?? '',
    module: r.module ?? '',
    functionScreen: r.functionScreen ?? '',
    types: (r.testType ?? '')
      .split(',')
      .map((t) => t.trim())
      .filter((t): t is Scenario['types'][number] => TYPES.has(t)),
    enhancementState: r.enhancementState ?? '',
    transactionState: r.transactionState ?? '',
    status: r.workflowStatus ?? '',
    role: r.userRole ?? '',
    businessCondition: r.businessCondition ?? '',
    existingValue: r.existingValue ?? '',
    actionChange: r.actionChange ?? '',
    confirmation: r.confirmation ?? '',
    testData: r.testData ?? '',
    description: r.description ?? r.title,
    expectedResult: r.expectedResult ?? '',
    priority: PRIORITY_LABEL[r.priority] ?? 'Medium',
    regression: r.regression,
    remarks: r.remarks ?? '',
    sourceReference: r.sourceReference,
    sourceQuote: r.sourceQuote,
    sourceVerified: r.sourceVerified,
    reviewStatus: r.reviewStatus,
    reviewComment: r.reviewComment,
  };
}

export const parseJson = <T>(s: string): T => JSON.parse(s) as T;

/** The other sheets of a stored workbook, parsed. */
export function workbookSheets(w: ScenarioWorkbook) {
  return {
    documents: parseJson<string[]>(w.documents),
    dimensions: parseJson<CheckedWorkbook['dimensions']>(w.dimensions),
    wip: parseJson<CheckedWorkbook['wip']>(w.wip),
    enhancement: parseJson<CheckedWorkbook['enhancement']>(w.enhancement),
    decisionTables: parseJson<CheckedWorkbook['decisionTables']>(w.decisionTables),
    requirementCoverage: parseJson<CheckedWorkbook['requirementCoverage']>(w.requirementCoverage),
    wipCoverage: parseJson<CheckedWorkbook['wipCoverage']>(w.wipCoverage),
    enhancementCoverage: parseJson<CheckedWorkbook['enhancementCoverage']>(w.enhancementCoverage),
    clarifications: parseJson<CheckedWorkbook['clarifications']>(w.clarifications),
    selfReview: parseJson<CheckedWorkbook['selfReview']>(w.selfReview),
    checks: parseJson<string[]>(w.checks),
  };
}

/**
 * Rebuild the workbook from what is stored now, so an export reflects every
 * edit and review decision. "approved" keeps only approved scenarios; the
 * summary is recalculated from the rows that are included.
 */
export async function loadCheckedWorkbook(db: Db, workbookId: string, scope: 'all' | 'approved') {
  const w = await db.scenarioWorkbook.findUniqueOrThrow({ where: { id: workbookId } });
  const rows = await db.testScenario.findMany({
    where: { workbookId, ...(scope === 'approved' ? { reviewStatus: 'APPROVED' } : {}) },
    orderBy: { scenarioCode: 'asc' },
  });
  const sheets = workbookSheets(w);
  const scenarios = rows.map(rowToScenario);
  const checks = [...sheets.checks];
  if (scope === 'approved') {
    const total = await db.testScenario.count({ where: { workbookId } });
    checks.unshift(`Approved-only export: ${scenarios.length} of ${total} scenario(s) included. Other sheets still list every scenario ID from the analysis.`);
  }
  const workbook: CheckedWorkbook = {
    dimensions: sheets.dimensions,
    wip: sheets.wip,
    enhancement: sheets.enhancement,
    selfReview: sheets.selfReview,
    scenarios,
    decisionTables: sheets.decisionTables,
    requirementCoverage: sheets.requirementCoverage,
    wipCoverage: sheets.wipCoverage,
    enhancementCoverage: sheets.enhancementCoverage,
    clarifications: sheets.clarifications,
    checks,
    summary: summarise(scenarios, sheets.decisionTables, sheets.clarifications.length, sheets.wip.applicable),
  };
  return { record: w, workbook, documents: sheets.documents };
}

/** The newest workbook of each CR (scenarios of older runs are kept but not shown by default). */
export async function latestWorkbookIds(db: Db, crIds?: string[]) {
  const all = await db.scenarioWorkbook.findMany({ where: crIds ? { crId: { in: crIds } } : {}, select: { id: true, crId: true, version: true } });
  const best = new Map<string, { id: string; version: number }>();
  for (const w of all) if ((best.get(w.crId)?.version ?? 0) < w.version) best.set(w.crId, w);
  return new Map([...best.entries()].map(([crId, w]) => [crId, w.id]));
}
