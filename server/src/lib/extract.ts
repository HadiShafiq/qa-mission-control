import ExcelJS from 'exceljs';
import mammoth from 'mammoth';

/**
 * Text extraction for CR documents, with a source reference for every piece of
 * text so extracted requirements can point back to page / section / cell.
 *
 *   PDF  → one segment per page            ref "Page 3"
 *   DOCX → one segment per heading section ref "Section 2.1 Approval rules"
 *   XLSX → one segment per non-empty row   ref "Sheet1!A5:F5" (cells labelled A5=…)
 *   PNG/JPEG → no text; the image itself is sent to the model (vision).
 *
 * Extraction never invents content: empty documents produce an empty segment
 * list and a warning, which the UI shows as-is.
 */

export type Segment = { ref: string; text: string };
export type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
/** A picture inside a document (e.g. before/after screenshots), marked "[Image N]" in the text. */
export type EmbeddedImage = { n: number; ref: string; context: string; mediaType: ImageMediaType; data: Buffer; sizeBytes: number };
export type Extraction = {
  fileType: string;
  segments: Segment[];
  /** Problems the user should look at (unreadable pictures, scanned pages…). */
  warnings: string[];
  /** Plain information, not a problem (e.g. how many pictures are sent). */
  notes: string[];
  charCount: number;
  /** Set for image files: the model receives the image instead of text. */
  image?: { mediaType: 'image/png' | 'image/jpeg' };
  /** Readable pictures embedded in the document, sent to the model with the text. */
  images: EmbeddedImage[];
};

const READABLE_IMAGES = new Set<string>(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
/** Anthropic's per-image limit. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export async function extractDocument(data: Buffer, fileType: string): Promise<Extraction> {
  let segments: Segment[] = [];
  const warnings: string[] = [];
  const notes: string[] = [];
  let image: Extraction['image'];
  let images: EmbeddedImage[] = [];

  switch (fileType) {
    case 'PDF':
      segments = await extractPdf(data, warnings);
      break;
    case 'DOCX':
      ({ segments, images } = await extractDocx(data, warnings, notes));
      break;
    case 'XLSX':
      segments = await extractXlsx(data, warnings);
      break;
    case 'PNG':
    case 'JPEG':
      image = { mediaType: fileType === 'PNG' ? 'image/png' : 'image/jpeg' };
      notes.push('Image file: the picture itself is sent to the AI, so references point to the image as a whole.');
      break;
    default:
      warnings.push(`Text extraction is not supported for ${fileType} files.`);
  }

  segments = segments.map((s) => ({ ref: s.ref, text: tidy(s.text) })).filter((s) => s.text);
  const charCount = segments.reduce((n, s) => n + s.text.length, 0);
  if (!image && charCount === 0 && !warnings.length) warnings.push('No text could be extracted from this document.');
  return { fileType, segments, warnings, notes, charCount, images, ...(image ? { image } : {}) };
}

function tidy(s: string) {
  return s
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ───────────────────────────── PDF ─────────────────────────────

type PdfTextItem = { str: string; hasEOL?: boolean };

async function extractPdf(data: Buffer, warnings: string[]): Promise<Segment[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // Text extraction only: no rendering, no fonts loaded, no scripting.
  const task = pdfjs.getDocument({ data: new Uint8Array(data), disableFontFace: true, useSystemFonts: false, verbosity: 0 });
  let doc;
  try {
    doc = await task.promise;
  } catch (err) {
    await task.destroy();
    const msg = err instanceof Error ? err.message : String(err);
    if (/password/i.test(msg)) warnings.push('The PDF is password-protected and cannot be read.');
    else warnings.push(`The PDF could not be read: ${msg}`);
    return [];
  }
  try {
    const segments: Segment[] = [];
    let emptyPages = 0;
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      let text = '';
      for (const item of content.items as PdfTextItem[]) {
        if (typeof item.str !== 'string') continue;
        text += item.str + (item.hasEOL ? '\n' : '');
      }
      if (!text.trim()) emptyPages++;
      segments.push({ ref: `Page ${n}`, text });
      page.cleanup();
    }
    if (doc.numPages > 0 && emptyPages === doc.numPages) {
      warnings.push('The PDF has no text layer (it is probably scanned). OCR is not supported yet, so upload a text-based PDF or the source DOCX.');
    } else if (emptyPages) {
      warnings.push(`${emptyPages} of ${doc.numPages} pages have no extractable text (scanned pages or images only).`);
    }
    return segments;
  } finally {
    await task.destroy();
  }
}

// ───────────────────────────── DOCX ─────────────────────────────

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decode(s: string) {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/**
 * mammoth turns Word headings into <h1>-<h6> and keeps tables and lists, so we
 * walk its (well-formed, limited) HTML output and group text by heading.
 */
async function extractDocx(data: Buffer, warnings: string[], notes: string[]): Promise<{ segments: Segment[]; images: EmbeddedImage[] }> {
  let html: string;
  // Every picture is numbered in document order; its position becomes "[Image N]" in the text.
  const found: { n: number; contentType: string; data: Buffer }[] = [];
  try {
    const result = await mammoth.convertToHtml(
      { buffer: data },
      {
        convertImage: mammoth.images.imgElement(async (img) => {
          const n = found.length + 1;
          found.push({ n, contentType: img.contentType, data: await img.read() });
          return { src: `qamc-img-${n}` };
        }),
      },
    );
    html = result.value;
  } catch (err) {
    warnings.push(`The Word document could not be read: ${err instanceof Error ? err.message : String(err)}`);
    return { segments: [], images: [] };
  }
  const readable = (i: (typeof found)[number]) => READABLE_IMAGES.has(i.contentType) && i.data.length <= MAX_IMAGE_BYTES;

  // Paragraphs are grouped by heading. Each top-level table is its own segment
  // ("Table 2 "B. Change Request Details"", rows labelled "Row N:"), because many
  // real CR forms are built from tables with no Word heading styles at all.
  const segments: Segment[] = [];
  let section: string | null = null;
  let sectionFirstTable = 0; // tables before the current heading
  let lines: string[] = [];
  let tableLines: string[] = [];
  let tableTitle: string | null = null;
  let tableNo = 0;
  let rowNo = 0;
  let cells: string[] | null = null;
  let buf = '';
  let inHeading = false;
  let tableDepth = 0;

  const paragraphRef = () => {
    if (section) return tableNo > sectionFirstTable ? `Section "${section}" (after Table ${tableNo})` : `Section "${section}"`;
    return tableNo ? `Text after Table ${tableNo}` : 'Text at document start';
  };
  const flushSection = () => {
    if (lines.length) segments.push({ ref: paragraphRef(), text: lines.join('\n') });
    lines = [];
  };
  const flushTable = () => {
    if (tableLines.length) {
      const title = tableTitle && tableTitle.length <= 80 ? ` "${tableTitle}"` : '';
      segments.push({ ref: `Table ${tableNo}${title}`, text: tableLines.join('\n') });
    }
    tableLines = [];
    tableTitle = null;
  };

  const token = /<(\/?)([a-z0-9]+)[^>]*?>|([^<]+)/gi;
  for (let m; (m = token.exec(html)); ) {
    const [, closing, rawTag, text] = m;
    if (text !== undefined) {
      buf += decode(text);
      continue;
    }
    const tag = rawTag.toLowerCase();
    if (tag === 'img') {
      const n = Number(/src="qamc-img-(\d+)"/.exec(m[0])?.[1]);
      const img = found[n - 1];
      if (img) buf += readable(img) ? ` [Image ${n}] ` : ` [Image ${n}: ${img.contentType.replace('image/', '').toUpperCase()} picture that cannot be read] `;
      continue;
    }
    if (/^h[1-6]$/.test(tag)) {
      if (!closing) {
        buf = '';
        inHeading = true;
      } else {
        const heading = tidy(buf);
        buf = '';
        inHeading = false;
        if (heading) {
          flushSection();
          section = heading;
          sectionFirstTable = tableNo;
        }
      }
      continue;
    }
    if (inHeading) continue;
    if (tag === 'table') {
      if (!closing) {
        tableDepth++;
        if (tableDepth === 1) {
          flushSection();
          tableNo++;
          rowNo = 0;
        }
      } else {
        tableDepth = Math.max(0, tableDepth - 1);
        if (tableDepth === 0) flushTable();
      }
      continue;
    }
    if (tag === 'tr' && tableDepth === 1) {
      if (!closing) {
        cells = [];
        rowNo++;
      } else if (cells) {
        const filled = cells.filter((c) => c);
        // A first row with a single filled cell is the table's title (e.g. "B. Change Request Details").
        if (rowNo === 1 && filled.length === 1) tableTitle = filled[0];
        if (filled.length) tableLines.push(`Row ${rowNo}: | ${cells.join(' | ')} |`);
        cells = null;
      }
      continue;
    }
    if ((tag === 'td' || tag === 'th') && tableDepth === 1) {
      if (!closing) buf = '';
      else if (cells) {
        cells.push(tidy(buf).replace(/\n/g, ' '));
        buf = '';
      }
      continue;
    }
    if (cells) {
      // paragraphs inside a table cell: keep accumulating into the cell
      if (closing && (tag === 'p' || tag === 'li')) buf += ' ';
      continue;
    }
    if (closing && (tag === 'p' || tag === 'li')) {
      const t = tidy(buf);
      if (t) lines.push(tag === 'li' ? `• ${t}` : t);
      buf = '';
    } else if (tag === 'br') buf += '\n';
  }
  if (tidy(buf)) lines.push(tidy(buf));
  flushSection();

  const images: EmbeddedImage[] = [];
  for (const i of found.filter(readable)) {
    const seg = segments.find((sg) => sg.text.includes(`[Image ${i.n}]`));
    images.push({ n: i.n, ref: `Image ${i.n}`, context: seg?.ref ?? 'document', mediaType: i.contentType as ImageMediaType, data: i.data, sizeBytes: i.data.length });
  }
  if (images.length) notes.push(`${images.length} picture(s) (e.g. screenshots) are sent to the AI with the text.`);
  const unreadable = found.filter((i) => !readable(i));
  if (unreadable.length) {
    const kinds = [...new Set(unreadable.map((i) => (i.data.length > MAX_IMAGE_BYTES ? 'larger than 5 MB' : i.contentType.replace('image/', '').toUpperCase())))].join(', ');
    warnings.push(`${unreadable.length} picture(s) cannot be read by the AI (${kinds}): Image ${unreadable.map((i) => i.n).join(', ')}. Check them in the document yourself.`);
  }
  return { segments, images };
}

// ───────────────────────────── XLSX ─────────────────────────────

function cellText(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('richText' in v) return v.richText.map((r) => r.text).join('');
    if ('formula' in v || 'sharedFormula' in v) {
      const r = (v as { result?: unknown }).result;
      if (r instanceof Date) return r.toISOString().slice(0, 10);
      return r === undefined || r === null || typeof r === 'object' ? '' : String(r);
    }
    if ('text' in v) return String((v as { text: unknown }).text);
    if ('error' in v) return String((v as { error: unknown }).error);
    return '';
  }
  return String(v);
}

async function extractXlsx(data: Buffer, warnings: string[]): Promise<Segment[]> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(data as unknown as ArrayBuffer);
  } catch (err) {
    warnings.push(`The workbook could not be read: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
  const segments: Segment[] = [];
  wb.eachSheet((ws) => {
    const hidden = ws.state !== 'visible';
    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      const parts: string[] = [];
      let first = '';
      let last = '';
      row.eachCell({ includeEmpty: false }, (cell) => {
        if (cell.isMerged && cell.master.address !== cell.address) return; // merged: text lives in the master cell
        const t = tidy(cellText(cell)).replace(/\n/g, ' ');
        if (!t) return;
        first ||= cell.address;
        last = cell.address;
        parts.push(`${cell.address}=${t}`);
      });
      if (!parts.length) return;
      const range = first === last ? first : `${first}:${last}`;
      segments.push({ ref: `${sheetRef(ws.name)}!${range}${hidden ? ' (hidden sheet)' : ''}`, text: parts.join(' | ') });
      void rowNumber;
    });
  });
  return segments;
}

/** Excel-style sheet reference: quote names with spaces or punctuation. */
export function sheetRef(name: string) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : `'${name.replace(/'/g, "''")}'`;
}

// ───────────────────────────── Matching ─────────────────────────────

/** Normalise text for quote verification: case, whitespace, quotes and dashes. */
export function normaliseForMatch(s: string) {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‘’‚′`]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/[•▪◦]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
