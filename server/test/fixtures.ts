import ExcelJS from 'exceljs';
import zlib from 'node:zlib';
import JSZip from 'jszip';
import type { z } from 'zod';
import { parseStructured, type AiClient, type AiContent, type StructuredRequest } from '../src/lib/ai.js';

/** A real, minimal multi-page PDF with one line of Helvetica text per page. */
export function makePdf(pages: string[][]): Buffer {
  const objs: string[] = [];
  const add = (s: string) => objs.push(s);
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'); // 1
  const pagesId = 2 + pages.length * 2;
  const kids: number[] = [];
  for (const lines of pages) {
    const esc = (t: string) => t.replace(/[\\()]/g, (c) => `\\${c}`);
    const body = lines.map((l, i) => `BT /F1 11 Tf 72 ${740 - i * 16} Td (${esc(l)}) Tj ET`).join('\n');
    add(`<< /Length ${Buffer.byteLength(body, 'latin1')} >>\nstream\n${body}\nendstream`);
    const contentId = objs.length;
    add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Contents ${contentId} 0 R /Resources << /Font << /F1 1 0 R >> >> >>`);
    kids.push(objs.length);
  }
  add(`<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`);
  add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  const catalogId = objs.length;
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

type DocxBlock = { h: 1 | 2 | 3; text: string } | { p: string } | { table: string[][] } | { image: Buffer; ext: 'png' | 'wmf' };

/** A real solid-colour PNG (default 24x24 red). */
export function makePng(w = 24, h = 24, rgb: [number, number, number] = [220, 20, 20]): Buffer {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set(rgb, y * (w * 3 + 1) + 1 + x * 3);
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const n of b) {
      c ^= n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (t: string, d: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(d.length);
    const td = Buffer.concat([Buffer.from(t), d]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** A real DOCX with heading styles, paragraphs and tables. */
export async function makeDocx(blocks: DocxBlock[]): Promise<Buffer> {
  const x = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
  const para = (t: string, style?: string) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:t xml:space="preserve">${x(t)}</w:t></w:r></w:p>`;
  const pictures: { id: string; file: string; data: Buffer }[] = [];
  const body = blocks
    .map((b) => {
      if ('h' in b) return para(b.text, `Heading${b.h}`);
      if ('p' in b) return para(b.p);
      if ('image' in b) {
        const n = pictures.length + 1;
        pictures.push({ id: `rIdImg${n}`, file: `image${n}.${b.ext}`, data: b.image });
        return `<w:p><w:r><w:drawing><wp:inline><wp:extent cx="914400" cy="914400"/><wp:docPr id="${n}" name="Picture ${n}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${n}" name="Picture ${n}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdImg${n}"/></pic:blipFill><pic:spPr/></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
      }
      return `<w:tbl>${b.table.map((row) => `<w:tr>${row.map((c) => `<w:tc>${para(c)}</w:tc>`).join('')}</w:tr>`).join('')}</w:tbl>`;
    })
    .join('');
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="wmf" ContentType="image/x-wmf"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
  );
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/_rels/document.xml.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      pictures.map((p) => `<Relationship Id="${p.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${p.file}"/>`).join('') +
      '</Relationships>',
  );
  for (const p of pictures) zip.file(`word/media/${p.file}`, p.data);
  zip.file(
    'word/styles.xml',
    `<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${[1, 2, 3].map((n) => `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/></w:style>`).join('')}</w:styles>`,
  );
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${body}</w:body></w:document>`);
  return zip.generateAsync({ type: 'nodebuffer' });
}

export async function makeXlsx(sheets: Record<string, (string | number | null)[][]>): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  for (const [name, rows] of Object.entries(sheets)) {
    const ws = wb.addWorksheet(name);
    rows.forEach((r) => ws.addRow(r));
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/**
 * Test double for the AI client. It never pretends to be the real model:
 * it returns whatever the test scripted, validated exactly like real output.
 */
export class ScriptedAi implements AiClient {
  readonly model = 'scripted-test-model';
  calls: { system: string; content: AiContent }[] = [];
  constructor(private respond: (req: { system: string; content: AiContent }) => unknown | Promise<unknown>) {}

  async countTokens({ system, content }: { system: string; content: AiContent }) {
    return Math.ceil((system.length + JSON.stringify(content).length) / 4);
  }

  async generate<S extends z.ZodType>({ system, content, schema, signal }: StructuredRequest<S>) {
    this.calls.push({ system, content });
    const raw = await this.respond({ system, content });
    if (signal?.aborted) throw new Error('aborted');
    if (raw instanceof Error) throw raw;
    const data = parseStructured(schema, typeof raw === 'string' ? raw : JSON.stringify(raw));
    return { data, model: this.model, stopReason: 'end_turn', inputTokens: 100, usage: { inputTokens: 100, outputTokens: 50, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } };
  }

  async ping() {
    return { model: this.model, displayName: 'Scripted test model' };
  }
}

/** Text of all text blocks sent to the model. */
export const promptText = (content: AiContent) => content.map((b) => (b.type === 'text' ? b.text : `[${b.type}]`)).join('\n');
