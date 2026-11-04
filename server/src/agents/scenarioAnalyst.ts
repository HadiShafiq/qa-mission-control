import { z } from 'zod';
import type { AppContext } from '../context.js';
import { buildScenarioWorkbook, validateScenarioWorkbook } from '../exports/scenarioWorkbook.js';
import { AiError } from '../lib/ai.js';
import { audit } from '../lib/audit.js';
import { NOT_CONNECTED_MESSAGE, loadTaskDocuments, renderDocuments, resolveSource, type AnalysedDocument } from './crAnalyst.js';
import type { TaskHandler } from './runner.js';
import { OUTPUT_NOTE, USER_SCENARIO_PROMPT } from './scenarioPrompt.js';

export const SCENARIO_ANALYST = 'SCENARIO_ANALYST';
export const SCENARIO_TIMEOUT_MS = 30 * 60 * 1000;

export const SCENARIO_TYPES = [
  'Positive',
  'Negative',
  'Main Flow',
  'Alternative Flow',
  'Business Rule',
  'Validation',
  'Boundary',
  'Status / Workflow',
  'Role / Access',
  'Enhancement',
  'WIP',
  'Non-WIP',
  'Data Behaviour',
  'Integration',
  'Regression',
  'Exception / Error',
] as const;
const COVERAGE = ['Covered', 'Partially Covered', 'Not Covered', 'N/A', 'TBD'] as const;
const text = z.string();

// What the model returns. No length/format constraints so it is accepted as a
// structured-output schema; every cross-reference is checked after parsing.
export const ScenarioWorkbookSchema = z.object({
  dimensions: z.array(
    z.object({
      name: text,
      values: z.array(text),
      applicability: z.enum(['Applicable', 'Not applicable', 'Unclear']),
      drivesBehaviour: z.boolean(),
      needsSeparateScenarios: z.boolean(),
      inDecisionTable: z.boolean(),
      sourceRef: text,
      notes: text,
    }),
  ),
  wip: z.object({ applicable: z.boolean(), statement: text }),
  enhancement: z.object({ applicable: z.boolean(), statement: text }),
  scenarios: z.array(
    z.object({
      key: text,
      requirementRef: text,
      documentIndex: z.number().int(),
      location: text,
      quote: text.nullable(),
      module: text,
      functionScreen: text,
      types: z.array(z.enum(SCENARIO_TYPES)),
      enhancementState: text,
      transactionState: text,
      status: text,
      role: text,
      businessCondition: text,
      existingValue: text,
      actionChange: text,
      confirmation: text,
      testData: text,
      description: text,
      expectedResult: text,
      priority: z.enum(['High', 'Medium', 'Low']),
      regression: z.boolean(),
      remarks: text,
    }),
  ),
  decisionTables: z.array(
    z.object({
      title: text,
      requirementRef: text,
      combinations: z.array(
        z.object({
          scenarioKey: text.nullable(),
          values: z.array(z.object({ condition: text, value: text })),
          expectedResult: text,
          status: z.enum(['Covered', 'TBD', 'Excluded']),
          note: text,
        }),
      ),
    }),
  ),
  requirementCoverage: z.array(
    z.object({
      requirementRef: text,
      requirement: text,
      applicableConditions: text,
      scenarioKeys: z.array(text),
      statusCoverage: text,
      roleCoverage: text,
      enhancementCoverage: text,
      transactionStateCoverage: text,
      decisionTableCoverage: text,
      coverageStatus: z.enum(COVERAGE),
      remarks: text,
    }),
  ),
  clarifications: z.array(z.object({ requirementRef: text, issue: text, why: text, impact: text, question: text })),
  wipCoverage: z.array(
    z.object({ requirementRef: text, businessRule: text, transactionState: text, scenarioKey: text.nullable(), expectedBehaviour: text, coverageStatus: z.enum(COVERAGE), remarks: text }),
  ),
  enhancementCoverage: z.array(
    z.object({
      requirementRef: text,
      functionScreen: text,
      before: text,
      after: text,
      scenarioKey: text.nullable(),
      expectedResult: text,
      coverageStatus: z.enum(COVERAGE),
      remarks: text,
    }),
  ),
  selfReview: z.array(z.object({ area: text, check: text, result: z.enum(['Pass', 'Fail', 'Partial', 'N/A']), note: text })),
});
export type ScenarioAnswer = z.infer<typeof ScenarioWorkbookSchema>;

// ───────────────────────── Checked workbook model ─────────────────────────

export type Scenario = Omit<ScenarioAnswer['scenarios'][number], 'key' | 'documentIndex' | 'location' | 'quote'> & {
  id: string;
  sourceReference: string | null;
  sourceQuote: string | null;
  sourceVerified: boolean;
};
export type CheckedWorkbook = Omit<ScenarioAnswer, 'scenarios' | 'decisionTables' | 'requirementCoverage' | 'wipCoverage' | 'enhancementCoverage' | 'clarifications'> & {
  scenarios: Scenario[];
  decisionTables: { title: string; requirementRef: string; combinations: (Omit<ScenarioAnswer['decisionTables'][number]['combinations'][number], 'scenarioKey'> & { scenarioId: string | null })[] }[];
  requirementCoverage: (Omit<ScenarioAnswer['requirementCoverage'][number], 'scenarioKeys'> & { scenarioIds: string[] })[];
  wipCoverage: (Omit<ScenarioAnswer['wipCoverage'][number], 'scenarioKey'> & { scenarioId: string | null })[];
  enhancementCoverage: (Omit<ScenarioAnswer['enhancementCoverage'][number], 'scenarioKey'> & { scenarioId: string | null })[];
  clarifications: (ScenarioAnswer['clarifications'][number] & { id: string; status: string })[];
  /** Problems found by the application's own checks (shown in the QA Self-Review sheet). */
  checks: string[];
  summary: Summary;
};

export type Summary = {
  totals: [string, number][];
  byModule: [string, number][];
  byFunction: [string, number][];
  byStatus: [string, number][];
  byRole: [string, number][];
  byEnhancementState: [string, number][];
  byTransactionState: [string, number][];
};

const pad = (n: number) => String(n).padStart(3, '0');

/**
 * Assign final IDs, remap every cross-reference, verify source quotes, and
 * compute the summary from the rows. Nothing the model says is counted or
 * trusted without a check; problems are listed instead of hidden.
 */
export function checkScenarioAnswer(answer: ScenarioAnswer, crNumber: string, docs: AnalysedDocument[]): CheckedWorkbook {
  const checks: string[] = [];
  const idOf = new Map<string, string>();
  const scenarios: Scenario[] = answer.scenarios.map((s, i) => {
    const id = `${crNumber}-TS-${pad(i + 1)}`;
    const key = s.key.trim();
    if (idOf.has(key)) checks.push(`Scenario key "${key}" was used twice; the second one became ${id}.`);
    else idOf.set(key, id);
    const src = resolveSource(
      { documentIndex: s.documentIndex, location: s.location, quote: s.quote } as Parameters<typeof resolveSource>[0],
      docs,
    );
    const { key: _k, documentIndex: _d, location: _l, quote, ...rest } = s;
    return { ...rest, id, sourceReference: src.reference, sourceQuote: quote, sourceVerified: src.verified };
  });

  const ref = (key: string | null, where: string) => {
    if (key === null || key.trim() === '') return null;
    const id = idOf.get(key.trim());
    if (!id) checks.push(`${where} points to scenario "${key}", which does not exist.`);
    return id ?? null;
  };

  const decisionTables = answer.decisionTables.map((t) => ({
    title: t.title,
    requirementRef: t.requirementRef,
    combinations: t.combinations.map(({ scenarioKey, ...c }, i) => {
      const scenarioId = ref(scenarioKey, `Decision table "${t.title}", combination ${i + 1}`);
      if (c.status === 'Covered' && !scenarioId) {
        checks.push(`Decision table "${t.title}", combination ${i + 1} was marked Covered but has no scenario; shown as TBD.`);
        return { ...c, scenarioId, status: 'TBD' as const, note: [c.note, 'No scenario mapped (application check).'].filter(Boolean).join(' ') };
      }
      return { ...c, scenarioId };
    }),
  }));

  const requirementCoverage = answer.requirementCoverage.map(({ scenarioKeys, ...c }) => {
    const scenarioIds = scenarioKeys.map((k) => ref(k, `Requirement coverage "${c.requirementRef}"`)).filter((x): x is string => Boolean(x));
    if ((c.coverageStatus === 'Covered' || c.coverageStatus === 'Partially Covered') && scenarioIds.length === 0) {
      checks.push(`Requirement "${c.requirementRef}" was marked ${c.coverageStatus} but no scenario is mapped; shown as Not Covered.`);
      return { ...c, scenarioIds, coverageStatus: 'Not Covered' as const, remarks: [c.remarks, 'No scenario mapped (application check).'].filter(Boolean).join(' ') };
    }
    return { ...c, scenarioIds };
  });

  const wipCoverage = answer.wip.applicable
    ? answer.wipCoverage.map(({ scenarioKey, ...w }) => ({ ...w, scenarioId: ref(scenarioKey, `WIP coverage "${w.requirementRef}"`) }))
    : [];
  if (!answer.wip.applicable && answer.wipCoverage.length) checks.push('WIP was declared not applicable, so the WIP coverage rows returned were not used.');
  const enhancementCoverage = answer.enhancement.applicable
    ? answer.enhancementCoverage.map(({ scenarioKey, ...e }) => ({ ...e, scenarioId: ref(scenarioKey, `Enhancement coverage "${e.requirementRef}"`) }))
    : [];

  const covered = new Set([...decisionTables.flatMap((t) => t.combinations.map((c) => c.scenarioId)), ...requirementCoverage.flatMap((c) => c.scenarioIds)]);
  const orphans = scenarios.filter((s) => !covered.has(s.id)).map((s) => s.id);
  if (orphans.length) checks.push(`${orphans.length} scenario(s) are not referenced by Requirement Coverage or a Decision Table: ${orphans.join(', ')}.`);
  const unverified = scenarios.filter((s) => !s.sourceVerified).length;
  if (unverified) checks.push(`${unverified} of ${scenarios.length} scenario(s) have a source quote that could not be found in the document text (pictures can't be text-checked). See the Source Verified column.`);

  const clarifications = answer.clarifications.map((c, i) => ({ ...c, id: `CL-${pad(i + 1)}`, status: 'Open' }));
  return {
    dimensions: answer.dimensions,
    wip: answer.wip,
    enhancement: answer.enhancement,
    selfReview: answer.selfReview,
    scenarios,
    decisionTables,
    requirementCoverage,
    wipCoverage,
    enhancementCoverage,
    clarifications,
    checks,
    summary: summarise(scenarios, decisionTables, clarifications.length, answer.wip.applicable),
  };
}

function countBy(rows: Scenario[], pick: (s: Scenario) => string): [string, number][] {
  const m = new Map<string, number>();
  for (const s of rows) {
    const k = pick(s).trim() || 'N/A';
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function summarise(scenarios: Scenario[], tables: CheckedWorkbook['decisionTables'], clarifications: number, wipApplicable: boolean): Summary {
  const has = (t: (typeof SCENARIO_TYPES)[number]) => scenarios.filter((s) => s.types.includes(t)).length;
  const combos = tables.flatMap((t) => t.combinations);
  const totals: [string, number][] = [
    ['Total number of scenarios', scenarios.length],
    ['Positive scenarios', has('Positive')],
    ['Negative scenarios', has('Negative')],
    ['Business Rule scenarios', has('Business Rule')],
    ['Validation scenarios', has('Validation')],
    ['Boundary scenarios', has('Boundary')],
    ['Status / Workflow scenarios', has('Status / Workflow')],
    ['Role / Access scenarios', has('Role / Access')],
    ['Enhancement scenarios', has('Enhancement')],
    ...(wipApplicable
      ? ([
          ['WIP scenarios', has('WIP')],
          ['Non-WIP scenarios', has('Non-WIP')],
        ] as [string, number][])
      : []),
    ['Integration scenarios', has('Integration')],
    ['Regression scenarios', scenarios.filter((s) => s.regression || s.types.includes('Regression')).length],
    ['Exception scenarios', has('Exception / Error')],
    ['Total Decision Table combinations', combos.filter((c) => c.status !== 'Excluded').length],
    ['Covered combinations', combos.filter((c) => c.status === 'Covered').length],
    ['TBD combinations', combos.filter((c) => c.status === 'TBD').length],
    ['Clarification Required count', clarifications],
  ];
  return {
    totals,
    byModule: countBy(scenarios, (s) => s.module),
    byFunction: countBy(scenarios, (s) => s.functionScreen),
    byStatus: countBy(scenarios, (s) => s.status),
    byRole: countBy(scenarios, (s) => s.role),
    byEnhancementState: countBy(scenarios, (s) => s.enhancementState),
    byTransactionState: countBy(scenarios, (s) => s.transactionState),
  };
}

// ───────────────────────── Task handler ─────────────────────────

export function scenarioAnalystHandler({ db, storage, ai }: AppContext): TaskHandler {
  return async ({ task, signal, progress }) => {
    if (!ai) throw new AiError('NOT_CONNECTED', NOT_CONNECTED_MESSAGE);
    const { cr, docs } = await loadTaskDocuments({ db, storage }, task, signal, progress);
    const content = renderDocuments(cr, docs, '', 'Analyse these CR / FRS documents and return the complete QA test scenario workbook content.');

    await progress(30, `Generating test scenarios with ${ai.model}. A full workbook can take 5–15 minutes.`);
    const result = await ai.generate({ system: USER_SCENARIO_PROMPT + OUTPUT_NOTE, content, schema: ScenarioWorkbookSchema, signal, timeoutMs: SCENARIO_TIMEOUT_MS });
    if (signal.aborted) throw new AiError('CANCELLED', 'Cancelled.');
    if (!result.data.scenarios.length) throw new Error('The analyst returned no test scenarios. Nothing was saved.');

    await progress(88, 'Checking cross-references and building the Excel workbook');
    const checked = checkScenarioAnswer(result.data, cr.crNumber, docs);

    const name = `${cr.crNumber} Test Scenarios`;
    const latest = await db.generatedArtifact.findFirst({ where: { projectId: cr.projectId, name }, orderBy: { version: 'desc' } });
    const version = (latest?.version ?? 0) + 1;
    const fileName = `${cr.crNumber}_Test_Scenarios_v${version}.xlsx`;
    const data = await buildScenarioWorkbook({ project: cr.project, cr, workbook: checked, version, model: result.model, documents: docs.map((d) => `${d.doc.originalName} (v${d.doc.version})`) });
    const problems = await validateScenarioWorkbook(data, checked.scenarios.length);
    if (problems.length) throw new Error(`The generated workbook failed validation: ${problems.join('; ')}. Nothing was saved.`);

    const file = await storage.saveBuffer(`projects/${cr.projectId}/crs/${cr.id}/artifacts`, fileName, data);
    const artifact = await db.$transaction(async (tx) => {
      const a = await tx.generatedArtifact.create({
        data: {
          projectId: cr.projectId,
          crId: cr.id,
          artifactType: 'SCENARIOS_XLSX',
          name,
          version,
          fileName,
          storageKey: file.key,
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          sizeBytes: file.sizeBytes,
          sha256: file.sha256,
        },
      });
      await audit(tx, { projectId: cr.projectId, entityType: 'GeneratedArtifact', entityId: a.id, action: 'GENERATED', summary: `Generated ${fileName} (${checked.scenarios.length} test scenarios)` });
      return a;
    });

    return {
      model: result.model,
      usage: result.usage,
      output: {
        artifactId: artifact.id,
        fileName,
        scenarioCount: checked.scenarios.length,
        clarificationCount: checked.clarifications.length,
        decisionTableCount: checked.decisionTables.length,
        unverifiedCount: checked.scenarios.filter((s) => !s.sourceVerified).length,
        wipApplicable: checked.wip.applicable,
        enhancementApplicable: checked.enhancement.applicable,
        totals: checked.summary.totals,
        checks: checked.checks,
        documents: docs.map((d) => ({ id: d.doc.id, name: d.doc.originalName, version: d.doc.version, warnings: d.extraction.warnings })),
      },
    };
  };
}
