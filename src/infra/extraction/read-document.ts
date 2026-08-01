import * as XLSX from 'xlsx';
import {
  type ExtractedDocument,
  type Grid,
  type TextRegion,
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
    case 'spreadsheet': {
      const { grid, sheets } = gridOf(bytes);
      return extractFromGrid(grid, sheets);
    }
    case 'pdf': {
      const { text, pages } = await textOfPdf(bytes);
      return extractFromText(text, pages);
    }
    case 'text':
      return extractFromText(new TextDecoder().decode(bytes));
    case 'unsupported':
      return {
        lines: [],
        sources: [],
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
 *
 * The sheet boundaries come back with the grid, because once every sheet is one
 * flat list "row 704" is a number an engineer cannot find in the file they
 * sent. The regions are what turn it back into *Schedule of Cables, row 12*.
 */
function gridOf(bytes: Uint8Array): {
  readonly grid: Grid;
  readonly sheets: readonly TextRegion[];
} {
  const book = XLSX.read(bytes, { type: 'array' });
  const rows: string[][] = [];
  const sheets: TextRegion[] = [];

  for (const name of book.SheetNames) {
    const sheet = book.Sheets[name];
    if (sheet === undefined) continue;
    const from = rows.length;
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
    // boundary between two of them. It belongs to the sheet it follows, so a
    // row index never falls into the gap between two regions.
    rows.push([]);
    sheets.push({ name, from, to: rows.length });
  }

  return { grid: rows, sheets };
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
/**
 * The browser globals pdf.js needs before it will even load.
 *
 * `pdf.mjs` runs `const SCALE_MATRIX = new DOMMatrix()` at module top level.
 * Node has no `DOMMatrix`, so pdf.js tries to borrow one from
 * `@napi-rs/canvas` — inside a `try`/`catch` that only warns on failure. When
 * that package is absent the warning is logged, the next line throws
 * `ReferenceError: DOMMatrix is not defined`, and the *import itself* fails.
 *
 * On Vercel it was absent. It is an optional dependency reached through a
 * dynamic `require` inside a `catch`, which the bundler's file tracing cannot
 * see, so nothing put it in the deployed function. Locally it resolved and
 * everything worked — the failure existed only where nobody could run a
 * debugger. It took a real customer RFQ and the production log to find.
 *
 * So the dependency is declared and installed here instead of being wished
 * for: a static import is something a bundler can follow, and assigning the
 * globals before the import means pdf.js finds them already present rather
 * than going looking.
 *
 * **The real implementation, not a stub.** Writing a small `DOMMatrix` would
 * be lighter, and `SCALE_MATRIX` is only read on the rendering path this app
 * never calls — today. A stub would be correct only for as long as that stays
 * true, and the way it would fail is by silently mis-transforming text
 * positions, which decide how characters group into lines, which decide what
 * quantity gets read off an RFQ. Wrong text out of a PDF is a wrong price to a
 * customer. Disk in a serverless function is the cheaper thing to spend.
 */
async function installPdfGlobals(): Promise<void> {
  if ('DOMMatrix' in globalThis) return;
  const canvas = await import('@napi-rs/canvas');
  const g = globalThis as Record<string, unknown>;
  g['DOMMatrix'] = canvas.DOMMatrix;
  g['Path2D'] = canvas.Path2D;
  g['ImageData'] = canvas.ImageData;
}

async function textOfPdf(bytes: Uint8Array): Promise<{
  readonly text: string;
  readonly pages: readonly TextRegion[];
}> {
  await installPdfGlobals();
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
  const pages: TextRegion[] = [];

  for (let p = 1; p <= doc.numPages; p++) {
    const from = out.length;
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
    pages.push({ name: `page ${p}`, from, to: out.length });
  }

  await doc.cleanup();
  return { text: out.join('\n'), pages };
}
