import type { Extraction } from './extract.js';

/**
 * Suggest CR number, title, version and project from an uploaded CR/FRS: first
 * from labelled fields in the document ("CRF No. : Redmine #30753"), then from
 * the filename ("Change Request-FL30753 - Title_V1.8.docx"). Every suggestion
 * says where it came from; nothing is guessed beyond what the text contains.
 */

export type Suggestion = { value: string; source: string };
export type CrInfo = { crNumber: Suggestion | null; title: Suggestion | null; version: Suggestion | null; projectName: Suggestion | null };

const LABELS = {
  crNumber: /^(?:[A-Z]\.\s*)?(?:CRF|CR|Change\s*Request(?:\s*Form)?|Redmine|Ticket)\s*(?:No\.?|Number|ID|#|Ref(?:erence)?)\s*[:：]?$/i,
  title: /^(?:[A-Z]\.\s*)?(?:CR\s*|Change\s*Request\s*|Document\s*)?(?:Title|Subject|Tajuk)\s*[:：]?$/i,
  version: /^(?:[A-Z]\.\s*)?(?:Document\s*|CR\s*)?Version\s*(?:No\.?)?\s*[:：]?$/i,
  projectName: /^(?:[A-Z]\.\s*)?(?:Project|System)\s*Name\s*[:：]?$/i,
};

/** Label/value pairs from table rows ("| Label : | value |") and "Label: value" lines. */
function pairs(extraction: Extraction) {
  const out: { label: string; value: string; ref: string }[] = [];
  for (const seg of extraction.segments) {
    for (const line of seg.text.split('\n')) {
      if (line.includes('|')) {
        const cells = line.replace(/^Row \d+:\s*/, '').split('|').map((c) => c.trim()).filter((c, i, a) => !(c === '' && (i === 0 || i === a.length - 1)));
        for (let i = 0; i < cells.length - 1; i++) {
          if (cells[i] && cells[i + 1]) out.push({ label: cells[i], value: cells[i + 1], ref: seg.ref });
        }
      } else {
        const m = /^([^:：]{2,40})[:：]\s*(.{1,200})$/.exec(line.trim());
        if (m) out.push({ label: `${m[1].trim()}:`, value: m[2].trim(), ref: seg.ref });
      }
    }
  }
  return out;
}

function fromFileName(fileName: string) {
  const base = fileName.replace(/\.[^.]+$/, '');
  const version = /[_\s-]v(\d+(?:\.\d+)*)$/i.exec(base)?.[1] ?? null;
  const noVersion = base.replace(/[_\s-]v\d+(?:\.\d+)*$/i, '');
  const rest = noVersion.replace(/^\s*(change\s*request|CRF?)\b[\s_-]*/i, '');
  const num = /\b([A-Z]{1,5})[\s#_-]?(\d{3,7})\b/i.exec(rest);
  const dash = noVersion.indexOf(' - ');
  const title = dash >= 0 ? noVersion.slice(dash + 3).replace(/_+/g, ' ').trim() : '';
  return { crNumber: num ? `${num[1]}${num[2]}`.toUpperCase() : null, title: title || null, version };
}

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

export function detectCrInfo(extraction: Extraction, fileName: string): CrInfo {
  const found = pairs(extraction);
  const pick = (re: RegExp) => found.find((p) => re.test(p.label) && clean(p.value).length > 0);
  const file = fromFileName(fileName);
  const fromFile = `filename "${fileName}"`;

  // CR number: the document's value, using the filename's prefixed form when it has the same digits.
  let crNumber: Suggestion | null = null;
  const crPair = pick(LABELS.crNumber);
  if (crPair) {
    const raw = clean(crPair.value);
    const token = /\b([A-Z]{1,5})[\s#_-]?(\d{3,7})\b/i.exec(raw);
    const digits = /(\d{3,7})/.exec(raw)?.[1];
    const fileHasSame = file.crNumber && digits && file.crNumber.endsWith(digits);
    const value = fileHasSame ? file.crNumber! : token && !/^redmine$/i.test(token[1]) ? `${token[1]}${token[2]}`.toUpperCase() : digits ?? null;
    if (value) {
      crNumber = {
        value,
        source: `document ${crPair.ref}: "${clean(crPair.label)} ${raw}"${fileHasSame ? ' (prefix from the filename)' : ''}`,
      };
    }
  }
  if (!crNumber && file.crNumber) crNumber = { value: file.crNumber, source: fromFile };

  const titlePair = pick(LABELS.title);
  const title = titlePair
    ? { value: clean(titlePair.value).slice(0, 200), source: `document ${titlePair.ref}: "${clean(titlePair.label)}"` }
    : file.title
      ? { value: file.title.slice(0, 200), source: fromFile }
      : null;

  const versionPair = pick(LABELS.version);
  const docVersion = versionPair ? /(\d+(?:\.\d+)*)/.exec(versionPair.value)?.[1] : undefined;
  const version = docVersion
    ? { value: docVersion, source: `document ${versionPair!.ref}: "${clean(versionPair!.label)} ${clean(versionPair!.value)}"` }
    : file.version
      ? { value: file.version, source: fromFile }
      : null;

  const projectPair = pick(LABELS.projectName);
  const projectName = projectPair ? { value: clean(projectPair.value).slice(0, 200), source: `document ${projectPair.ref}: "${clean(projectPair.label)}"` } : null;

  return { crNumber, title, version, projectName };
}
