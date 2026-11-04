import type { ChangeRequest, Project, Requirement } from '@prisma/client';
import ExcelJS from 'exceljs';

/**
 * Requirements analysis workbook.
 *   Information     — project / CR metadata and review counts
 *   Requirements    — one row per requirement, frozen header, filters, dropdowns
 *   Analysis Notes  — CR summary, impacted modules and regression impact from the
 *                     latest completed analysis (only when one exists)
 * Values are plain cells (no formulas) so the file stays editable anywhere.
 */

export type AnalysisNotes = { crSummary: string; impactedModules: string[]; regressionImpact: string[]; model: string | null; finishedAt: Date | null };

const LABELS: Record<string, string> = {
  FUNCTIONAL: 'Functional',
  NON_FUNCTIONAL: 'Non-functional',
  EXPLICIT: 'Explicit',
  INFERRED: 'Inferred',
  ASSUMPTION: 'Assumption',
  CLARIFICATION_REQUIRED: 'Clarification required',
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
  PENDING: 'Pending',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  AI: 'AI extracted',
  MANUAL: 'Manual',
};
const label = (v: string) => LABELS[v] ?? v;

const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E5F' } };
const KEY_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF1' } };
const BORDER: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FFB7C4CB' } },
  left: { style: 'thin', color: { argb: 'FFB7C4CB' } },
  bottom: { style: 'thin', color: { argb: 'FFB7C4CB' } },
  right: { style: 'thin', color: { argb: 'FFB7C4CB' } },
};
const FONT = { name: 'Calibri', size: 10 };

export const REQUIREMENT_COLUMNS = [
  { header: 'Requirement ID', key: 'code', width: 18 },
  { header: 'CR Number', key: 'cr', width: 13 },
  { header: 'Module', key: 'module', width: 18 },
  { header: 'Feature', key: 'feature', width: 20 },
  { header: 'Requirement Description', key: 'description', width: 60 },
  { header: 'Requirement Type', key: 'type', width: 15, list: ['Functional', 'Non-functional'] },
  { header: 'Classification', key: 'classification', width: 20, list: ['Explicit', 'Inferred', 'Assumption', 'Clarification required'] },
  { header: 'Business Rule', key: 'rule', width: 40 },
  { header: 'User Role', key: 'role', width: 18 },
  { header: 'Source Reference', key: 'source', width: 34 },
  { header: 'Source Quote', key: 'quote', width: 45 },
  { header: 'Source Verified', key: 'verified', width: 11, list: ['Yes', 'No'] },
  { header: 'Risk', key: 'risk', width: 9, list: ['Low', 'Medium', 'High'] },
  { header: 'Review Status', key: 'status', width: 20, list: ['Pending', 'Approved', 'Rejected', 'Clarification required'] },
  { header: 'Review Comment', key: 'comment', width: 35 },
  { header: 'Origin', key: 'origin', width: 12 },
  { header: 'Revision', key: 'revision', width: 9 },
  { header: 'Analyst Rationale', key: 'rationale', width: 40 },
] as const;

export async function buildRequirementsWorkbook(opts: {
  project: Project;
  cr: ChangeRequest;
  requirements: Requirement[];
  scope: 'all' | 'approved';
  version: number;
  preparedBy: string;
  notes: AnalysisNotes | null;
}): Promise<Buffer> {
  const { project, cr, requirements, scope, version, preparedBy, notes } = opts;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'QA Mission Control';
  wb.created = new Date();
  wb.title = `${cr.crNumber} Requirements Analysis`;

  // ── Information ──
  const info = wb.addWorksheet('Information', { properties: { tabColor: { argb: 'FF1F4E5F' } } });
  info.columns = [
    { key: 'k', width: 28 },
    { key: 'v', width: 70 },
  ];
  const title = info.addRow([`${cr.crNumber} — Requirements Analysis`]);
  title.font = { ...FONT, size: 14, bold: true };
  info.addRow([]);
  const count = (s: string) => requirements.filter((r) => r.reviewStatus === s).length;
  const rows: [string, string | number | Date][] = [
    ['Project Code', project.code],
    ['Project Name', project.name],
    ['CR Number', cr.crNumber],
    ['CR Title', cr.title],
    ['CR Version', cr.version],
    ['Document Version', `v${version}`],
    ['Export Scope', scope === 'approved' ? 'Approved requirements only' : 'All requirements'],
    ['Prepared By', preparedBy],
    ['Prepared Date', new Date()],
    ['Total Requirements', requirements.length],
    ['Approved', count('APPROVED')],
    ['Pending Review', count('PENDING')],
    ['Clarification Required', count('CLARIFICATION_REQUIRED')],
    ['Rejected', count('REJECTED')],
    ['Source Verified', requirements.filter((r) => r.sourceVerified).length],
  ];
  for (const [k, v] of rows) {
    const row = info.addRow([k, v]);
    row.getCell(1).font = { ...FONT, bold: true };
    row.getCell(1).fill = KEY_FILL;
    row.getCell(2).font = FONT;
    row.getCell(2).alignment = { horizontal: 'left', vertical: 'top', wrapText: true };
    if (v instanceof Date) row.getCell(2).numFmt = 'dd mmm yyyy hh:mm';
    row.eachCell((c) => (c.border = BORDER));
  }
  info.addRow([]);
  const note = info.addRow([
    'Note',
    'AI-extracted requirements are a draft until a reviewer approves them. "Source Verified = Yes" means the quoted text was found at the stated location in the uploaded document; it does not mean the requirement is correct.',
  ]);
  note.getCell(1).font = { ...FONT, bold: true };
  note.getCell(2).font = { ...FONT, italic: true };
  note.getCell(2).alignment = { wrapText: true, vertical: 'top' };
  info.pageSetup = { orientation: 'portrait', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 };

  // ── Requirements ──
  const ws = wb.addWorksheet('Requirements', { views: [{ state: 'frozen', xSplit: 1, ySplit: 1 }] });
  ws.columns = REQUIREMENT_COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.width }));
  const header = ws.getRow(1);
  header.height = 30;
  header.eachCell((c) => {
    c.font = { ...FONT, bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = HEADER_FILL;
    c.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
    c.border = BORDER;
  });

  for (const r of requirements) {
    const row = ws.addRow({
      code: r.requirementCode,
      cr: cr.crNumber,
      module: r.module ?? '',
      feature: r.feature ?? '',
      description: r.description,
      type: label(r.requirementType),
      classification: label(r.classification),
      rule: r.businessRule ?? '',
      role: r.userRole ?? '',
      source: r.sourceReference ?? '',
      quote: r.sourceQuote ?? '',
      verified: r.sourceVerified ? 'Yes' : 'No',
      risk: label(r.risk),
      status: label(r.reviewStatus),
      comment: r.reviewComment ?? '',
      origin: label(r.origin),
      revision: r.revision,
      rationale: r.rationale ?? '',
    });
    row.eachCell({ includeEmpty: true }, (c) => {
      c.font = FONT;
      c.alignment = { vertical: 'top', wrapText: true };
      c.border = BORDER;
    });
  }

  // Dropdowns on the enumerated columns, a little beyond the data so new rows get them too.
  const lastRow = Math.max(requirements.length + 1, 2) + 100;
  REQUIREMENT_COLUMNS.forEach((col, i) => {
    if (!('list' in col)) return;
    for (let r = 2; r <= lastRow; r++) {
      ws.getCell(r, i + 1).dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: [`"${col.list.join(',')}"`],
        showErrorMessage: true,
        errorTitle: 'Invalid value',
        error: `Choose one of: ${col.list.join(', ')}`,
      };
    }
  });
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(requirements.length + 1, 1), column: REQUIREMENT_COLUMNS.length } };
  ws.pageSetup = {
    orientation: 'landscape',
    paperSize: 9, // A4
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    printTitlesRow: '1:1',
    margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 },
  };
  ws.headerFooter = { oddFooter: `${cr.crNumber} Requirements v${version} — Page &P of &N` };

  // ── Analysis Notes ──
  if (notes) {
    const an = wb.addWorksheet('Analysis Notes');
    an.columns = [
      { key: 'k', width: 26 },
      { key: 'v', width: 90 },
    ];
    const add = (k: string, v: string) => {
      const row = an.addRow([k, v]);
      row.getCell(1).font = { ...FONT, bold: true };
      row.getCell(1).fill = KEY_FILL;
      row.getCell(2).font = FONT;
      row.getCell(2).alignment = { wrapText: true, vertical: 'top' };
      row.eachCell((c) => (c.border = BORDER));
    };
    add('CR Summary', notes.crSummary || '—');
    add('Impacted Modules', notes.impactedModules.length ? notes.impactedModules.join('\n') : '—');
    add('Regression Impact', notes.regressionImpact.length ? notes.regressionImpact.map((x) => `• ${x}`).join('\n') : '—');
    add('Analysed By', notes.model ? `CR Analyst agent (${notes.model})` : 'CR Analyst agent');
    if (notes.finishedAt) add('Analysed At', notes.finishedAt.toISOString().replace('T', ' ').slice(0, 16) + ' UTC');
    an.pageSetup = { orientation: 'portrait', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Re-open the generated file and check its structure before it is offered for download. */
export async function validateRequirementsWorkbook(data: Buffer, expectedRows: number) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data as unknown as ArrayBuffer);
  const ws = wb.getWorksheet('Requirements');
  const problems: string[] = [];
  if (!wb.getWorksheet('Information')) problems.push('Information sheet missing');
  if (!ws) problems.push('Requirements sheet missing');
  else {
    const headers = REQUIREMENT_COLUMNS.map((_, i) => String(ws.getCell(1, i + 1).value ?? ''));
    if (headers.join('|') !== REQUIREMENT_COLUMNS.map((c) => c.header).join('|')) problems.push('Header row does not match');
    let rows = 0;
    ws.eachRow((row, n) => {
      if (n > 1 && row.getCell(1).value) rows++;
    });
    if (rows !== expectedRows) problems.push(`Expected ${expectedRows} requirement rows, found ${rows}`);
  }
  return problems;
}
