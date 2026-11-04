import type { ChangeRequest, Project } from '@prisma/client';
import ExcelJS from 'exceljs';
import type { CheckedWorkbook } from '../agents/scenarioAnalyst.js';

/**
 * QA Test Scenario workbook, following the user's scenario prompt (sections 10–16).
 * Excel forbids "/" in sheet names, so the sheets are named
 * "Decision Table" and "WIP-Transaction Coverage"; the full titles from the
 * prompt appear in each sheet's first row.
 */

export const SHEETS = {
  scenarios: 'Test Scenarios',
  decision: 'Decision Table',
  coverage: 'Requirement Coverage',
  clarification: 'Clarification Required',
  summary: 'Scenario Summary',
  wip: 'WIP-Transaction Coverage',
  enhancement: 'Enhancement Coverage',
  dimensions: 'Test Dimensions',
  review: 'QA Self-Review',
} as const;

const FONT = { name: 'Calibri', size: 10 };
const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E5F' } };
const SUB_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF1' } };
const TBD_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3ECFA' } };
const LINE = { style: 'thin' as const, color: { argb: 'FFB7C4CB' } };
const BORDER: Partial<ExcelJS.Borders> = { top: LINE, left: LINE, bottom: LINE, right: LINE };

type Col = { header: string; width: number; list?: string[] };

/** A standard table sheet: frozen header, autofilter, wrap, borders, dropdowns, A4 landscape. */
function tableSheet(wb: ExcelJS.Workbook, name: string, cols: Col[], rows: (string | number)[][], opts: { freezeCols?: number; footer: string }) {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1, xSplit: opts.freezeCols ?? 1 }] });
  ws.columns = cols.map((c) => ({ header: c.header, width: c.width }));
  const head = ws.getRow(1);
  head.height = 32;
  head.eachCell((c) => {
    c.font = { ...FONT, bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = HEADER_FILL;
    c.alignment = { vertical: 'middle', wrapText: true };
    c.border = BORDER;
  });
  for (const r of rows) {
    const row = ws.addRow(r);
    row.eachCell({ includeEmpty: true }, (c) => {
      c.font = FONT;
      c.alignment = { vertical: 'top', wrapText: true };
      c.border = BORDER;
      if (c.value === 'TBD') c.fill = TBD_FILL;
    });
  }
  const last = Math.max(rows.length + 1, 2) + 100;
  cols.forEach((c, i) => {
    if (!c.list) return;
    for (let r = 2; r <= last; r++) {
      ws.getCell(r, i + 1).dataValidation = { type: 'list', allowBlank: true, formulae: [`"${c.list.join(',')}"`], showErrorMessage: true, error: `Choose one of: ${c.list.join(', ')}` };
    }
  });
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(rows.length + 1, 1), column: cols.length } };
  ws.pageSetup = { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '1:1', margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 } };
  ws.headerFooter = { oddFooter: `${opts.footer} — &A — Page &P of &N` };
  return ws;
}

const COVERAGE_LIST = ['Covered', 'Partially Covered', 'Not Covered', 'N/A', 'TBD'];
const yesNo = (b: boolean) => (b ? 'Yes' : 'No');

export async function buildScenarioWorkbook(opts: { project: Project; cr: ChangeRequest; workbook: CheckedWorkbook; version: number; model: string; documents: string[] }): Promise<Buffer> {
  const { project, cr, workbook: w, version, model, documents } = opts;
  const footer = `${cr.crNumber} Test Scenarios v${version}`;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'QA Mission Control';
  wb.created = new Date();
  wb.title = `${cr.crNumber} QA Test Scenarios`;

  // 1. Test Scenarios (the 19 columns of section 10, plus source traceability for section 17)
  tableSheet(
    wb,
    SHEETS.scenarios,
    [
      { header: 'Test Scenario ID', width: 17 },
      { header: 'Requirement / CR Reference', width: 22 },
      { header: 'Source Location', width: 30 },
      { header: 'Source Verified', width: 10, list: ['Yes', 'No'] },
      { header: 'Module', width: 16 },
      { header: 'Function / Screen', width: 20 },
      { header: 'Test Scenario Type', width: 18 },
      { header: 'Enhancement State', width: 15 },
      { header: 'Transaction / Workflow State', width: 17 },
      { header: 'Status', width: 16 },
      { header: 'Role', width: 16 },
      { header: 'Business Condition', width: 26 },
      { header: 'Existing Value / Condition', width: 22 },
      { header: 'Action / Change', width: 24 },
      { header: 'Confirmation / Decision', width: 16 },
      { header: 'Test Data / Precondition', width: 30 },
      { header: 'Test Scenario Description', width: 45 },
      { header: 'Expected Result', width: 50 },
      { header: 'Priority', width: 9, list: ['High', 'Medium', 'Low'] },
      { header: 'Regression', width: 10, list: ['Yes', 'No'] },
      { header: 'Remarks', width: 30 },
    ],
    w.scenarios.map((s) => [
      s.id,
      s.requirementRef,
      s.sourceReference ?? '',
      yesNo(s.sourceVerified),
      s.module,
      s.functionScreen,
      s.types.join(', '),
      s.enhancementState,
      s.transactionState,
      s.status,
      s.role,
      s.businessCondition,
      s.existingValue,
      s.actionChange,
      s.confirmation,
      s.testData,
      s.description,
      s.expectedResult,
      s.priority,
      yesNo(s.regression),
      s.remarks,
    ]),
    { footer },
  );

  // 2. Decision Table / Combination Matrix: one block per table, rows "Condition = value", X per scenario
  const dt = wb.addWorksheet(SHEETS.decision, { views: [{ state: 'frozen', xSplit: 1, ySplit: 1 }] });
  dt.getColumn(1).width = 42;
  const title = dt.addRow(['Decision Table / Combination Matrix']);
  title.getCell(1).font = { ...FONT, size: 13, bold: true };
  if (!w.decisionTables.length) dt.addRow(['No decision table: the source does not combine several conditions that affect behaviour.']).getCell(1).font = { ...FONT, italic: true };
  for (const t of w.decisionTables) {
    dt.addRow([]);
    const h = dt.addRow([`${t.title}${t.requirementRef ? ` (${t.requirementRef})` : ''}`]);
    h.getCell(1).font = { ...FONT, bold: true, size: 11 };
    const cols = t.combinations.map((c, i) => c.scenarioId ?? (c.status === 'Excluded' ? `Excluded ${i + 1}` : `TBD ${i + 1}`));
    const header = dt.addRow(['Condition', ...cols]);
    header.eachCell((c) => {
      c.font = { ...FONT, bold: true, color: { argb: 'FFFFFFFF' } };
      c.fill = HEADER_FILL;
      c.border = BORDER;
      c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    });
    header.getCell(1).alignment = { vertical: 'middle' };
    // condition rows in first-seen order
    const keys: string[] = [];
    for (const c of t.combinations) for (const v of c.values) if (!keys.includes(`${v.condition} = ${v.value}`)) keys.push(`${v.condition} = ${v.value}`);
    for (const k of keys) {
      const r = dt.addRow([k, ...t.combinations.map((c) => (c.values.some((v) => `${v.condition} = ${v.value}` === k) ? 'X' : ''))]);
      r.eachCell({ includeEmpty: true }, (c, n) => {
        c.font = FONT;
        c.border = BORDER;
        c.alignment = n === 1 ? { vertical: 'top', wrapText: true } : { horizontal: 'center', vertical: 'top' };
      });
    }
    for (const [label, pick] of [
      ['Expected Result', (c: (typeof t.combinations)[number]) => c.expectedResult],
      ['Coverage', (c: (typeof t.combinations)[number]) => c.status],
      ['Note', (c: (typeof t.combinations)[number]) => c.note],
    ] as const) {
      const r = dt.addRow([label, ...t.combinations.map(pick)]);
      r.eachCell({ includeEmpty: true }, (c, n) => {
        c.font = n === 1 ? { ...FONT, bold: true } : FONT;
        c.fill = SUB_FILL;
        c.border = BORDER;
        c.alignment = { vertical: 'top', wrapText: true };
        if (c.value === 'TBD') c.fill = TBD_FILL;
      });
    }
    cols.forEach((_c, i) => (dt.getColumn(i + 2).width = Math.max(dt.getColumn(i + 2).width ?? 0, 22)));
  }
  dt.pageSetup = { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  dt.headerFooter = { oddFooter: `${footer} — &A — Page &P of &N` };

  // 3. Requirement Coverage
  tableSheet(
    wb,
    SHEETS.coverage,
    [
      { header: 'Requirement Reference', width: 20 },
      { header: 'Requirement / Business Rule', width: 45 },
      { header: 'Applicable Conditions', width: 28 },
      { header: 'Scenario ID(s)', width: 24 },
      { header: 'Status Coverage', width: 18 },
      { header: 'Role Coverage', width: 18 },
      { header: 'Enhancement Coverage', width: 18 },
      { header: 'Transaction State Coverage', width: 18 },
      { header: 'Decision Table Coverage', width: 18 },
      { header: 'Coverage Status', width: 15, list: COVERAGE_LIST },
      { header: 'Remarks', width: 30 },
    ],
    w.requirementCoverage.map((c) => [
      c.requirementRef,
      c.requirement,
      c.applicableConditions,
      c.scenarioIds.join(', '),
      c.statusCoverage,
      c.roleCoverage,
      c.enhancementCoverage,
      c.transactionStateCoverage,
      c.decisionTableCoverage,
      c.coverageStatus,
      c.remarks,
    ]),
    { footer },
  );

  // 4. Clarification Required
  tableSheet(
    wb,
    SHEETS.clarification,
    [
      { header: 'Clarification ID', width: 13 },
      { header: 'Requirement Reference', width: 20 },
      { header: 'Issue / Question', width: 40 },
      { header: 'Why Clarification Is Required', width: 36 },
      { header: 'Impact on Testing', width: 32 },
      { header: 'Suggested Question to BA', width: 42 },
      { header: 'Status', width: 12, list: ['Open', 'Answered', 'Closed'] },
    ],
    w.clarifications.map((c) => [c.id, c.requirementRef, c.issue, c.why, c.impact, c.question, c.status]),
    { footer },
  );

  // 5. Scenario Summary (computed by the application from the rows)
  const sm = wb.addWorksheet(SHEETS.summary);
  sm.columns = [{ width: 42 }, { width: 14 }];
  const block = (heading: string, rows: [string, number][]) => {
    const h = sm.addRow([heading, 'Count']);
    h.eachCell((c) => {
      c.font = { ...FONT, bold: true, color: { argb: 'FFFFFFFF' } };
      c.fill = HEADER_FILL;
      c.border = BORDER;
    });
    for (const [k, v] of rows.length ? rows : ([['(none)', 0]] as [string, number][])) {
      const r = sm.addRow([k, v]);
      r.eachCell((c) => {
        c.font = FONT;
        c.border = BORDER;
        c.alignment = { vertical: 'top', wrapText: true };
      });
    }
    sm.addRow([]);
  };
  const info = sm.addRow([`${cr.crNumber} — ${cr.title}`]);
  info.getCell(1).font = { ...FONT, size: 13, bold: true };
  sm.addRow([`Project ${project.code} · CR version ${cr.version} · Workbook v${version} · ${new Date().toISOString().slice(0, 10)}`]).getCell(1).font = FONT;
  sm.addRow([`Source: ${documents.join('; ')} · Generated by ${model}. Counts are calculated from the rows in this workbook.`]).getCell(1).font = { ...FONT, italic: true };
  sm.addRow([]);
  block('Scenario totals', w.summary.totals);
  block('By Module', w.summary.byModule);
  block('By Function / Screen', w.summary.byFunction);
  block('By Status', w.summary.byStatus);
  block('By Role', w.summary.byRole);
  block('By Enhancement State', w.summary.byEnhancementState);
  if (w.wip.applicable) block('By Transaction State', w.summary.byTransactionState);

  // 6. WIP / Transaction State Coverage
  const wipRows: (string | number)[][] = w.wip.applicable
    ? w.wipCoverage.map((r) => [r.requirementRef, r.businessRule, r.transactionState, r.scenarioId ?? 'TBD', r.expectedBehaviour, r.coverageStatus, r.remarks])
    : [['N/A', 'WIP / Non-WIP Transaction State: N/A based on source requirement.', 'N/A', 'N/A', w.wip.statement, 'N/A', '']];
  tableSheet(
    wb,
    SHEETS.wip,
    [
      { header: 'Requirement Reference', width: 20 },
      { header: 'Business Rule', width: 44 },
      { header: 'Transaction State', width: 20 },
      { header: 'Scenario ID', width: 18 },
      { header: 'Expected Behaviour', width: 46 },
      { header: 'Coverage Status', width: 15, list: COVERAGE_LIST },
      { header: 'Remarks', width: 30 },
    ],
    wipRows,
    { footer },
  );

  // 7. Enhancement Coverage
  const enhRows: (string | number)[][] = w.enhancement.applicable
    ? w.enhancementCoverage.map((r) => [r.requirementRef, r.functionScreen, r.before, r.after, r.scenarioId ?? 'TBD', r.expectedResult, r.coverageStatus, r.remarks])
    : [['N/A', 'N/A', 'N/A', 'N/A', 'N/A', w.enhancement.statement, 'N/A', '']];
  tableSheet(
    wb,
    SHEETS.enhancement,
    [
      { header: 'Requirement Reference', width: 20 },
      { header: 'Function / Screen', width: 22 },
      { header: 'Before Enhancement Behaviour', width: 40 },
      { header: 'After Enhancement Behaviour', width: 40 },
      { header: 'Scenario ID', width: 18 },
      { header: 'Expected Result', width: 44 },
      { header: 'Coverage Status', width: 15, list: COVERAGE_LIST },
      { header: 'Remarks', width: 30 },
    ],
    enhRows,
    { footer },
  );

  // 8. Test Dimensions (section 2 and 4)
  tableSheet(
    wb,
    SHEETS.dimensions,
    [
      { header: 'Dimension / Condition', width: 26 },
      { header: 'Values', width: 40 },
      { header: 'Applicability', width: 15 },
      { header: 'Drives Behaviour', width: 11 },
      { header: 'Needs Separate Scenarios', width: 12 },
      { header: 'In Decision Table', width: 11 },
      { header: 'Source', width: 30 },
      { header: 'Notes', width: 40 },
    ],
    w.dimensions.map((d) => [d.name, d.values.join(', '), d.applicability, yesNo(d.drivesBehaviour), yesNo(d.needsSeparateScenarios), yesNo(d.inDecisionTable), d.sourceRef, d.notes]),
    { footer },
  );

  // 9. QA Self-Review (section 19) + the application's own checks
  const reviewRows: (string | number)[][] = [
    ...w.selfReview.map((r) => [r.area, r.check, r.result, r.note]),
    ...(w.checks.length ? w.checks : ['All cross-references between sheets resolved; no problems found.']).map((c) => ['Automatic check by QA Mission Control', c, w.checks.length ? 'Review' : 'Pass', '']),
  ];
  tableSheet(
    wb,
    SHEETS.review,
    [
      { header: 'Area', width: 26 },
      { header: 'Check', width: 60 },
      { header: 'Result', width: 10, list: ['Pass', 'Fail', 'Partial', 'N/A', 'Review'] },
      { header: 'Note', width: 50 },
    ],
    reviewRows,
    { footer },
  );

  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Re-open the file and check structure before it is offered for download. */
export async function validateScenarioWorkbook(data: Buffer, expectedScenarios: number) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data as unknown as ArrayBuffer);
  const problems: string[] = [];
  for (const name of Object.values(SHEETS)) if (!wb.getWorksheet(name)) problems.push(`${name} sheet missing`);
  const ws = wb.getWorksheet(SHEETS.scenarios);
  if (ws) {
    if (ws.getCell('A1').value !== 'Test Scenario ID') problems.push('Test Scenarios header is wrong');
    let rows = 0;
    const ids = new Set<string>();
    ws.eachRow((row, n) => {
      if (n === 1) return;
      const id = String(row.getCell(1).value ?? '');
      if (!id) return;
      rows++;
      if (ids.has(id)) problems.push(`Duplicate Test Scenario ID ${id}`);
      ids.add(id);
    });
    if (rows !== expectedScenarios) problems.push(`Expected ${expectedScenarios} scenario rows, found ${rows}`);
  }
  return problems;
}
