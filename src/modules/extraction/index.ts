/**
 * Reading a customer's document.
 *
 * The controlling design decision, from ARCHITECTURE.md: **extraction produces
 * the same shape `matching` already consumes from pasted text.** A cable
 * description and a quantity, one line each. So this module ends where paste
 * begins, and Phase 2 did not change by a single line to accommodate it. If it
 * had, the phase boundary would have been drawn in the wrong place.
 *
 * Pure. `infra/extraction` turns a file into a grid or a page of text; this
 * decides what any of it means.
 *
 * The second rule is the same one the rest of the app lives by: **anything
 * ambiguous is handed back for a person to look at, never guessed.** A
 * document that cannot be read confidently produces a stated refusal and the
 * raw text, so an engineer can paste over it — which is strictly better than a
 * job full of lines nobody can trust.
 */

/** A spreadsheet as SheetJS hands it over: rows of cells, already stringified. */
export type Grid = readonly (readonly string[])[];

export interface ExtractedDocument {
  /** One cable per line, in the form the review screen parses. */
  readonly lines: readonly string[];
  /** What was read, and how confidently. Shown to the engineer. */
  readonly notes: readonly string[];
  /** True when the document could not be read and the raw text is all there is. */
  readonly unreadable: boolean;
  /** Everything found, so nothing is silently dropped. */
  readonly rawText: string;
}

/** Column meanings the importer knows how to use. */
export type ColumnKind = 'description' | 'quantity' | 'unit' | 'ignore';

/**
 * Header vocabularies.
 *
 * Deliberately a short, explicit list rather than fuzzy matching. A header this
 * does not recognise makes the column `ignore`, which is visible and fixable; a
 * header it *mis*recognises silently quotes the wrong quantity.
 */
const HEADERS: Readonly<Record<Exclude<ColumnKind, 'ignore'>, readonly string[]>> = {
  description: [
    'description',
    'item description',
    'material description',
    'cable',
    'cable description',
    'specification',
    'spec',
    'particulars',
    'item',
  ],
  quantity: ['qty', 'quantity', 'quantity required', 'qty.', 'length', 'total qty', 'reqd qty'],
  unit: ['unit', 'uom', 'units', 'u.o.m'],
};

const fold = (s: string) =>
  s.toLowerCase().replace(/[.'’]/g, '').replace(/[_\-–—]/g, ' ').replace(/\s+/g, ' ').trim();

export function classifyHeader(cell: string): ColumnKind {
  const f = fold(cell);
  if (f === '') return 'ignore';
  for (const [kind, names] of Object.entries(HEADERS)) {
    if (names.includes(f)) return kind as ColumnKind;
  }
  return 'ignore';
}

/**
 * Finds the header row.
 *
 * RFQ spreadsheets carry a letterhead, an address block and a couple of blank
 * rows before the table starts, so the header is rarely row 0. The row scoring
 * highest on recognised headers wins, and a row with no recognised headers at
 * all never wins — which is what makes "no table here" an answer rather than a
 * wrong guess.
 */
export function findHeaderRow(
  grid: Grid,
): { readonly index: number; readonly columns: readonly ColumnKind[] } | null {
  let best: { index: number; columns: ColumnKind[]; score: number } | null = null;

  // Only the first 30 rows: past that it is a second table, not a late header.
  for (let i = 0; i < Math.min(grid.length, 30); i++) {
    const columns = (grid[i] ?? []).map(classifyHeader);
    const score =
      (columns.includes('description') ? 2 : 0) + (columns.includes('quantity') ? 2 : 0);
    if (score === 0) continue;
    if (best === null || score > best.score) best = { index: i, columns, score };
  }

  // A description column alone is not a table worth reading: without a
  // quantity every line would fall back to a default, and a quote built on
  // defaulted quantities is worse than no quote.
  if (best === null || best.score < 4) return null;
  return { index: best.index, columns: best.columns };
}

const NUMBER = /^\s*([\d,]+(?:\.\d+)?)\s*$/;

/** `1,250.5` → `1250.5`. Anything else → null, never a guess. */
export function readQuantity(cell: string): string | null {
  const m = NUMBER.exec(cell);
  if (m === null) return null;
  const value = m[1]!.replace(/,/g, '');
  return Number(value) > 0 ? value : null;
}

/**
 * A spreadsheet RFQ, turned into lines.
 *
 * Quantities are appended in the form the line parser already reads — `— 1,250
 * m` — rather than carried in a parallel structure. One parser, one set of
 * rules about what a quantity is, and no second place for the two to disagree.
 */
export function extractFromGrid(grid: Grid): ExtractedDocument {
  const rawText = grid.map((r) => r.join('\t')).join('\n');
  const header = findHeaderRow(grid);

  if (header === null) {
    return {
      lines: [],
      notes: [
        'No table with both a description and a quantity column was found. ' +
          'The text below is everything the file contained — paste the cable ' +
          'lines in by hand, or add this file’s column headings to the ' +
          'vocabulary the importer knows.',
      ],
      unreadable: true,
      rawText,
    };
  }

  const col = (kind: ColumnKind) => header.columns.indexOf(kind);
  const descriptionAt = col('description');
  const quantityAt = col('quantity');
  const unitAt = col('unit');

  const lines: string[] = [];
  const skipped: string[] = [];

  for (let i = header.index + 1; i < grid.length; i++) {
    const row = grid[i] ?? [];
    const description = (row[descriptionAt] ?? '').trim();
    if (description === '') continue;

    // A row whose "description" is a total or a note is not a cable.
    if (/^(total|sub\s*total|notes?|remarks?)\b/i.test(description)) continue;

    const quantityCell = (row[quantityAt] ?? '').trim();
    const quantity = readQuantity(quantityCell);

    if (quantity === null) {
      skipped.push(
        `row ${i + 1}: “${description.slice(0, 60)}” has no readable quantity` +
          (quantityCell === '' ? '' : ` (found “${quantityCell}”)`),
      );
      continue;
    }

    const unit = unitAt >= 0 ? fold(row[unitAt] ?? '') : '';
    const metres = unit.startsWith('k') ? String(Number(quantity) * 1000) : quantity;

    lines.push(`${description} — ${Number(metres).toLocaleString('en-GB')} m`);
  }

  const notes = [
    `Read ${lines.length} line${lines.length === 1 ? '' : 's'} from a table starting at row ${header.index + 1}.`,
    ...(skipped.length === 0
      ? []
      : [
          `${skipped.length} row${skipped.length === 1 ? '' : 's'} skipped, ` +
            'because a quantity that cannot be read is not a quantity worth ' +
            'guessing at:',
          ...skipped.slice(0, 8),
          ...(skipped.length > 8 ? [`…and ${skipped.length - 8} more.`] : []),
        ]),
  ];

  return { lines, notes, unreadable: lines.length === 0, rawText };
}

/**
 * A cable line looks like a cable line.
 *
 * Used on PDF text, where there is no table structure to lean on. Deliberately
 * strict: it wants a core-by-size pattern *and* a quantity, because a page of
 * prose containing the word "cable" is not an RFQ line and reading it as one
 * would put a line in front of an engineer that never existed.
 */
const CABLE_SHAPE = /\b\d+\s*(?:c|core|cores|pr|pair|pairs)?\s*[x×*]\s*\d+(?:\.\d+)?/i;
const HAS_QUANTITY = /\b\d[\d,]*(?:\.\d+)?\s*(?:k?m|metres?|meters?)\b/i;

export function looksLikeCableLine(line: string): boolean {
  return CABLE_SHAPE.test(line) && HAS_QUANTITY.test(line);
}

/**
 * A PDF, turned into lines.
 *
 * Layout-aware extraction gives back text that is roughly line-per-line but
 * carries headers, footers, page numbers and terms. Rather than trying to find
 * the table, this keeps the lines that look like cables and says how many it
 * dropped — so an engineer can see at a glance whether the reading was
 * plausible, and the whole text is there when it was not.
 */
export function extractFromText(text: string): ExtractedDocument {
  const all = text
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l !== '');

  const lines = all.filter(looksLikeCableLine);

  if (lines.length === 0) {
    return {
      lines: [],
      notes: [
        all.length === 0
          ? 'No text could be read from this PDF. It is most likely a scan — ' +
            'this app does not read images, deliberately, because a misread ' +
            'digit is a wrong price. Paste the lines in instead.'
          : 'Text was read, but no line carried both a cable description and a ' +
            'quantity. The whole text is below — paste the cable lines in by hand.',
      ],
      unreadable: true,
      rawText: all.join('\n'),
    };
  }

  return {
    lines,
    notes: [
      `Read ${lines.length} cable line${lines.length === 1 ? '' : 's'} from ${all.length} lines of text.`,
      'Lines without both a cable description and a quantity were left out. ' +
        'Check the extracted text against the document before approving.',
    ],
    unreadable: false,
    rawText: all.join('\n'),
  };
}
