import * as XLSX from 'xlsx';
import {
  type ExtractedDocument,
  type Grid,
  extractFromGrid,
  extractFromText,
} from '@/modules/extraction';

/**
 * Turning an uploaded file into something the extraction module can read.
 *
 * This adapter knows about file formats and nothing about cables. It hands the
 * pure module a grid or a page of text; the module decides what any of it
 * means. That split is why the extraction rules are testable without a fixture
 * file and why swapping the PDF library later touches one function.
 *
 * **No OCR, deliberately.** A scanned RFQ produces a stated refusal rather than
 * an attempt, because a misread digit in a quantity is a wrong price on a
 * document that goes to a customer. Twenty minutes of retyping costs less than
 * the margin on the order — the same trade the whole app is built on.
 */

export type DocumentKind = 'spreadsheet' | 'pdf' | 'text' | 'unsupported';

export function kindOf(filename: string, mime: string): DocumentKind {
  const name = filename.toLowerCase();
  if (/\.(xlsx|xlsm|xls|csv|tsv)$/.test(name)) return 'spreadsheet';
  if (name.endsWith('.pdf') || mime === 'application/pdf') return 'pdf';
  if (/\.(txt|md)$/.test(name) || mime.startsWith('text/')) return 'text';
  return 'unsupported';
}

export async function readDocument(
  bytes: Uint8Array,
  filename: string,
  mime: string,
): Promise<ExtractedDocument> {
  switch (kindOf(filename, mime)) {
    case 'spreadsheet':
      return extractFromGrid(gridOf(bytes));
    case 'pdf':
      return extractFromText(await textOfPdf(bytes));
    case 'text':
      return extractFromText(new TextDecoder().decode(bytes));
    case 'unsupported':
      return {
        lines: [],
        notes: [
          `“${filename}” is not a format this app reads. Spreadsheets, PDFs and ` +
            'plain text are; images and Word documents are not. Paste the cable ' +
            'lines in instead.',
        ],
        unreadable: true,
        rawText: '',
      };
  }
}

/**
 * Every sheet, concatenated.
 *
 * An RFQ workbook routinely puts the covering letter on one sheet and the
 * schedule on another, and picking only the first would read the letter and
 * miss the cables. `findHeaderRow` then locates the table wherever it landed.
 */
function gridOf(bytes: Uint8Array): Grid {
  const book = XLSX.read(bytes, { type: 'array' });
  const rows: string[][] = [];

  for (const name of book.SheetNames) {
    const sheet = book.Sheets[name];
    if (sheet === undefined) continue;
    const sheetRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      raw: false,
      defval: '',
      blankrows: true,
    });
    for (const row of sheetRows) {
      rows.push(row.map((cell) => (cell === null ? '' : String(cell))));
    }
    // A blank row between sheets, so a table cannot appear to run across the
    // boundary between two of them.
    rows.push([]);
  }

  return rows;
}

/**
 * PDF text, in reading order, one line per visual line.
 *
 * pdf.js gives back positioned text items rather than lines, so items are
 * grouped by their y coordinate — within a small tolerance, because a line of
 * text is rarely at exactly one y. Getting this wrong would run a description
 * and the quantity beside it into two separate lines, which is precisely the
 * pairing the extractor needs.
 */
async function textOfPdf(bytes: Uint8Array): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

  const doc = await pdfjs.getDocument({
    data: bytes,
    // No worker: this runs in a serverless function, where spawning one buys
    // nothing and fails in some runtimes.
    useWorkerFetch: false,
    useSystemFonts: false,
    // Silent: pdf.js warns about missing standard font data on every document,
    // and it is warning about rendering. Nothing here renders — only text
    // positions are read — so the warning is noise in a serverless log.
    verbosity: 0,
  }).promise;

  const out: string[] = [];

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();

    const byLine = new Map<number, { x: number; text: string }[]>();
    for (const item of content.items) {
      if (!('str' in item) || item.str.trim() === '') continue;
      const transform = item.transform as number[];
      const y = Math.round((transform[5] ?? 0) / 3) * 3;
      const x = transform[4] ?? 0;
      byLine.set(y, [...(byLine.get(y) ?? []), { x, text: item.str }]);
    }

    // Descending y: PDF coordinates start at the bottom of the page.
    for (const y of [...byLine.keys()].sort((a, b) => b - a)) {
      const line = (byLine.get(y) ?? [])
        .sort((a, b) => a.x - b.x)
        .map((i) => i.text)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (line !== '') out.push(line);
    }

    page.cleanup();
  }

  await doc.cleanup();
  return out.join('\n');
}
