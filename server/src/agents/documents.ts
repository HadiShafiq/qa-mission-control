import type { ChangeRequest, Project, SourceDocument } from '@prisma/client';
import type { AppContext } from '../context.js';
import { AiError, type AiContent } from '../lib/ai.js';
import { extractDocument, normaliseForMatch, type Extraction } from '../lib/extract.js';

/**
 * Shared by the agents that read CR / FRS documents: loading the task's
 * documents, laying them out for the model (untrusted content, tags escaped,
 * pictures as image blocks) and verifying the source quotes it returns.
 */

export type AnalysedDocument = { doc: SourceDocument; extraction: Extraction; data?: Buffer };

/** What the model says about where something came from. */
export type SourceClaim = { documentIndex: number; location: string; quote: string | null };

function escapeTag(s: string) {
  return s.replace(/<(\/?)(document|segment|documents|existing_requirements)/gi, '‹$1$2');
}
function attr(s: string) {
  return s.replace(/[&"<>]/g, (c) => ({ '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' })[c]!);
}


/**
 * The CR header, every document as <document>/<segment ref> blocks (untrusted
 * content, tags escaped), then each picture as a labelled image block.
 * Shared by every agent that reads CR documents.
 */
export function renderDocuments(cr: ChangeRequest & { project: Project }, docs: AnalysedDocument[], before: string, instruction: string): AiContent {
  const content: AiContent = [];
  let text = `<change_request number="${attr(cr.crNumber)}" version="${attr(cr.version)}" project="${attr(cr.project.code)}">\nTitle: ${escapeTag(cr.title)}\n${cr.description ? `Description (entered by the user): ${escapeTag(cr.description)}\n` : ''}</change_request>\n\n`;
  text += before + '<documents>\n';

  docs.forEach(({ doc, extraction }, i) => {
    const head = `<document index="${i + 1}" name="${attr(doc.originalName)}" version="${doc.version}" type="${doc.fileType}">`;
    if (extraction.image) {
      text += `${head}\n(The image is attached right after this text block, in document order.)\n</document>\n`;
      return;
    }
    text += `${head}\n`;
    for (const s of extraction.segments) text += `<segment ref="${attr(s.ref)}">\n${escapeTag(s.text)}\n</segment>\n`;
    if (!extraction.segments.length) text += '(no extractable text)\n';
    if (extraction.images.length) text += `(${extraction.images.length} picture(s) from this document are attached after the text, labelled "Document ${i + 1}, Image N".)\n`;
    text += '</document>\n';
  });
  text += `</documents>\n\n${instruction}`;
  content.push({ type: 'text', text });

  docs.forEach(({ doc, extraction }, i) => {
    for (const img of extraction.images) {
      content.push({ type: 'text', text: `Document ${i + 1} (${doc.originalName}), ${img.ref}, which appears in ${img.context}:` });
      content.push({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data.toString('base64') } });
    }
  });

  docs.forEach(({ doc, extraction, data }, i) => {
    if (!extraction.image || !data) return;
    content.push({ type: 'text', text: `Image for document index ${i + 1} (${doc.originalName}):` });
    content.push({ type: 'image', source: { type: 'base64', media_type: extraction.image.mediaType, data: data.toString('base64') } });
  });

  return content;
}


// ───────────────────────── Source verification ─────────────────────────

/** Strip the structural labels our extractor adds, so quotes match plain text. */
function plain(s: string) {
  return normaliseForMatch(
    s
      .replace(/\[Table \d+\]/g, ' ')
      .replace(/Row \d+:/g, ' ')
      .replace(/(^|\|)\s*\$?[A-Z]{1,3}\$?\d+=/g, ' ')
      .replace(/\|/g, ' '),
  );
}

const MIN_QUOTE = 8;

/**
 * Confirm the quoted text exists in the cited document. The reference stored is
 * the location where the quote was actually found, so a wrong page or section
 * from the model is corrected rather than trusted.
 */
export function resolveSource(item: SourceClaim, docs: AnalysedDocument[]) {
  const claimed = docs[item.documentIndex - 1];
  const quote = item.quote ? plain(item.quote) : '';

  const label = (d: AnalysedDocument, ref: string) => `${d.doc.originalName} (v${d.doc.version}) › ${ref}`;

  if (quote.length >= MIN_QUOTE) {
    const order = claimed ? [claimed, ...docs.filter((d) => d !== claimed)] : docs;
    for (const d of order) {
      const segs = d.extraction.segments;
      const preferred = segs.find((s) => s.ref === item.location || sameRow(item.location, s.ref) || tableRow(item.location, s.ref) !== null);
      const candidates = preferred ? [preferred, ...segs.filter((s) => s !== preferred)] : segs;
      const hit = candidates.find((s) => plain(s.text).includes(quote));
      if (hit) {
        const ref = (d.doc.fileType === 'XLSX' && sameRow(item.location, hit.ref)) || rowContains(item.location, hit, quote) ? item.location : hit.ref;
        return { document: d.doc, reference: label(d, ref), verified: true };
      }
    }
  }
  if (claimed) {
    // A picture inside the document: point at it. It can't be text-verified, so it stays unverified.
    const n = Number(/^Image\s+(\d+)\b/i.exec(item.location.trim())?.[1]);
    const pic = claimed.extraction.images.find((p) => p.n === n);
    if (pic) return { document: claimed.doc, reference: label(claimed, `${pic.ref} (in ${pic.context})`), verified: false };
    const ref = claimed.extraction.image ? 'Whole image' : item.location || 'location not given';
    return { document: claimed.doc, reference: label(claimed, ref), verified: false };
  }
  return { document: null, reference: item.location || null, verified: false };
}

/** Sheet1!C5 is inside the row segment Sheet1!A5:F5. */
function sameRow(cell: string, rowRef: string) {
  const c = /^(.+)!\$?([A-Z]{1,3})\$?(\d+)$/.exec(cell.trim());
  const r = /^(.+)!([A-Z]{1,3})(\d+)(?::([A-Z]{1,3})(\d+))?/.exec(rowRef);
  return Boolean(c && r && c[1] === r[1] && c[3] === r[3]);
}

/** 'Table 2 "B. Details", Row 5' → 5 when it refers to the segment 'Table 2 "B. Details"'. */
function tableRow(location: string, segRef: string) {
  if (!segRef.startsWith('Table ') || !location.startsWith(segRef)) return null;
  const m = /^,?\s*Row\s+(\d+)\s*$/i.exec(location.slice(segRef.length));
  return m ? Number(m[1]) : null;
}

/** A row-level reference is kept only when the quote is really in that row. */
function rowContains(location: string, seg: { ref: string; text: string }, quote: string) {
  const row = tableRow(location, seg.ref);
  if (row === null) return false;
  const line = seg.text.split('\n').find((l) => l.startsWith(`Row ${row}:`));
  return Boolean(line && plain(line).includes(quote));
}


export type AnalysisTaskInput = { documentIds: string[] };

export const NOT_CONNECTED_MESSAGE =
  'AI is not connected. Install and sign in to Claude Code, run `ant auth login`, or set ANTHROPIC_API_KEY in server/.env, then restart the server.';

/** Load the task's CR and read + extract the documents it was started with. */
export async function loadTaskDocuments(
  { db, storage }: Pick<AppContext, 'db' | 'storage'>,
  task: { crId: string | null; input: string | null },
  signal: AbortSignal,
  progress: (percent: number, message: string) => Promise<void>,
) {
  const input = JSON.parse(task.input ?? '{}') as AnalysisTaskInput;
  const cr = await db.changeRequest.findUnique({ where: { id: task.crId ?? '' }, include: { project: true } });
  if (!cr) throw new Error('The change request no longer exists.');

  const sourceDocs = await db.sourceDocument.findMany({ where: { id: { in: input.documentIds }, crId: cr.id }, orderBy: [{ originalName: 'asc' }, { version: 'desc' }] });
  if (!sourceDocs.length) throw new Error('None of the selected documents exist any more.');

  await progress(5, `Reading ${sourceDocs.length} document(s)`);
  const docs: AnalysedDocument[] = [];
  for (const [i, doc] of sourceDocs.entries()) {
    if (signal.aborted) throw new AiError('CANCELLED', 'Cancelled.');
    if (!(await storage.exists(doc.storageKey))) throw new Error(`${doc.originalName} (v${doc.version}) is missing from disk.`);
    const data = await storage.readBuffer(doc.storageKey);
    const extraction = await extractDocument(data, doc.fileType);
    docs.push({ doc, extraction, data: extraction.image ? data : undefined });
    await progress(5 + ((i + 1) / sourceDocs.length) * 20, `Read ${doc.originalName}`);
  }
  if (docs.every((d) => !d.extraction.segments.length && !d.extraction.image)) {
    throw new Error(`No text could be extracted from the selected documents. ${docs.flatMap((d) => d.extraction.warnings).join(' ')}`.trim());
  }
  return { cr, docs };
}

