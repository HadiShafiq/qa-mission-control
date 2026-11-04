import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { OPEN_DEFECT_STATUSES } from '../domain/constants.js';
import { parseAudit } from '../lib/audit.js';

/**
 * Every figure here is computed from persisted rows. Percentages are `null`
 * (not 0) when the denominator is zero, so the UI can show an empty state
 * rather than a misleading "0%".
 *
 * Formulas (documented in ARCHITECTURE.md → "Metric definitions"):
 *   automationCoverage  = test cases with ≥1 automation script / test cases
 *   executionProgress   = test cases whose latest run is PASSED|FAILED|BLOCKED|NOT_APPLICABLE / test cases
 *   evidenceCompletion  = test cases with ≥1 evidence record / test cases
 *   passed/failed/blocked = test cases whose LATEST run has that status (retests don't double-count)
 *   pendingApprovals    = requirements awaiting review (PENDING or CLARIFICATION_REQUIRED) + pending Approval rows
 * Scope: non-archived CRs inside non-archived projects.
 */
export async function dashboardRoutes(app: FastifyInstance, { db, ai }: AppContext) {
  app.get('/api/dashboard/summary', async () => {
    const activeCr = { archivedAt: null, project: { archivedAt: null } };
    const tcScope = { scenario: { changeRequest: activeCr } };

    const [
      totalProjects,
      totalCrs,
      requirements,
      uncoveredRequirements,
      scenarios,
      approvedScenarios,
      testCases,
      automatedTestCases,
      testCasesWithEvidence,
      openDefects,
      pendingApprovals,
      runs,
      activeCrs,
      recentActivity,
      agentActivity,
      documents,
    ] = await Promise.all([
      db.project.count({ where: { archivedAt: null } }),
      db.changeRequest.count({ where: activeCr }),
      db.requirement.count({ where: { changeRequest: activeCr } }),
      db.requirement.count({ where: { changeRequest: activeCr, reviewStatus: 'APPROVED', scenarioLinks: { none: {} } } }),
      db.testScenario.count({ where: { changeRequest: activeCr } }),
      db.testScenario.count({ where: { changeRequest: activeCr, reviewStatus: 'APPROVED' } }),
      db.testCase.count({ where: tcScope }),
      db.testCase.count({ where: { ...tcScope, automationScripts: { some: {} } } }),
      db.testCase.count({ where: { ...tcScope, evidence: { some: {} } } }),
      db.defect.count({ where: { project: { archivedAt: null }, status: { in: [...OPEN_DEFECT_STATUSES] } } }),
      Promise.all([
        db.approval.count({ where: { status: 'PENDING' } }),
        db.requirement.count({ where: { changeRequest: activeCr, reviewStatus: { in: ['PENDING', 'CLARIFICATION_REQUIRED'] } } }),
      ]).then(([a, r]) => a + r),
      db.executionRun.findMany({
        where: { testCase: tcScope },
        orderBy: { startedAt: 'desc' },
        select: { testCaseId: true, status: true },
      }),
      db.changeRequest.findMany({
        where: activeCr,
        orderBy: { updatedAt: 'desc' },
        take: 6,
        include: { project: { select: { id: true, code: true } }, _count: { select: { documents: { where: { archivedAt: null } } } } },
      }),
      db.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 12, include: { project: { select: { code: true } } } }),
      db.agentTask.findMany({ orderBy: { createdAt: 'desc' }, take: 6 }),
      db.sourceDocument.count({ where: { archivedAt: null, changeRequest: activeCr } }),
    ]);

    // Latest run per test case (runs are ordered newest first).
    const latest = new Map<string, string>();
    for (const r of runs) if (!latest.has(r.testCaseId)) latest.set(r.testCaseId, r.status);
    const byStatus: Record<string, number> = {};
    for (const s of latest.values()) byStatus[s] = (byStatus[s] ?? 0) + 1;
    const executed = (byStatus.PASSED ?? 0) + (byStatus.FAILED ?? 0) + (byStatus.BLOCKED ?? 0) + (byStatus.NOT_APPLICABLE ?? 0);

    const pct = (n: number, d: number) => (d === 0 ? null : Math.round((n / d) * 1000) / 10);

    return {
      generatedAt: new Date().toISOString(),
      counts: {
        totalProjects,
        totalCrs,
        sourceDocuments: documents,
        requirements,
        uncoveredRequirements,
        scenarios,
        approvedScenarios,
        testCases,
        passed: byStatus.PASSED ?? 0,
        failed: byStatus.FAILED ?? 0,
        blocked: byStatus.BLOCKED ?? 0,
        notRun: testCases - latest.size,
        openDefects,
        pendingApprovals,
      },
      percentages: {
        automationCoverage: pct(automatedTestCases, testCases),
        executionProgress: pct(executed, testCases),
        evidenceCompletion: pct(testCasesWithEvidence, testCases),
      },
      executionStatus: byStatus,
      activeCrs: activeCrs.map(({ _count, ...c }) => ({ ...c, documentCount: _count.documents })),
      recentActivity: recentActivity.map(parseAudit),
      agentActivity,
      ai: { configured: Boolean(ai) },
    };
  });

  app.get('/api/activity', async (req) => {
    const limit = Math.min(Math.max(Number((req.query as { limit?: string }).limit) || 50, 1), 200);
    const rows = await db.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: limit, include: { project: { select: { code: true } } } });
    return rows.map(parseAudit);
  });
}
