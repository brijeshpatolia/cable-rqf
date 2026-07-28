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

/**
 * A named stretch of a document: one sheet of a workbook, one page of a PDF.
 *
 * The reader flattens a whole file into lines, which is what makes the
 * extraction rules simple — but "row 704" of a three-sheet workbook is not
 * something an engineer can find. Regions are how a flat index says
 * *Schedule of Cables, row 12* instead.
 */
export interface TextRegion {
  readonly name: string;
  /** Inclusive index into the document's lines. */
  readonly from: number;
  /** Exclusive. */
  readonly to: number;
}

/**
 * Where one extracted line came from.
 *
 * The Phase 3 promise is that an engineer never has to open the attachment to
 * check a number. That requires the app to have kept the answer, not to be
 * able to guess at it later — a line reads `3Cx50 mm2 XLPE — 12,500 m` after
 * extraction, and nothing in that string says which row of which sheet it was
 * assembled from.
 */
export interface SourceRegion {
  /** Zero-based index into `rawText`'s lines — what the source view scrolls to. */
  readonly line: number;
  /** Where the document itself would say it is: `Schedule, row 12`, `page 2`. */
  readonly where: string;
}

export interface ExtractedDocument {
  /** One cable per line, in the form the review screen parses. */
  readonly lines: readonly string[];
  /**
   * Where each line came from, one per entry of `lines` and in the same order.
   *
   * Parallel rather than a list of pairs, because `lines` is what flows on
   * into matching and must keep the shape pasted text already had. Provenance
   * travels beside the enquiry, never inside it.
   */
  readonly sources: readonly SourceRegion[];
  /** What was read, and how confidently. Shown to the engineer. */
  readonly notes: readonly string[];
  /** True when the document could not be read and the raw text is all there is. */
  readonly unreadable: boolean;
  /** Everything found, so nothing is silently dropped. */
  readonly rawText: string;
}

/** `Schedule of Cables, row 12`, or just `row 12` when a file has one region. */
function placeOf(
  regions: readonly TextRegion[],
  index: number,
  unit: 'row' | 'line',
): string {
  const region = regions.find((r) => index >= r.from && index < r.to);
  if (region === undefined) return `${unit} ${index + 1}`;
  return `${region.name}, ${unit} ${index + 1 - region.from}`;
}

/** Column meanings the importer knows how to use. */
export type ColumnKind = 'description' | 'item' | 'serial' | 'quantity' | 'unit' | 'ignore';

/**
 * Header vocabularies.
 *
 * Deliberately a short, explicit list rather than fuzzy matching. A header this
 * does not recognise makes the column `ignore`, which is visible and fixable; a
 * header it *mis*recognises silently quotes the wrong quantity.
 *
 * **`item` is not a description column.** It used to sit in the description
 * list, and on the commonest RFQ layout of all — `Item | Description | Qty |
 * Unit` — both of the first two columns classified as description. The column
 * was then chosen with `indexOf`, so the leftmost won and every cable
 * description was replaced by its row number: the file read as `1 — 12,500 m`,
 * `2 — 3,500 m`, with `unreadable: false` and a note saying two lines had been
 * read successfully. Wrong data, presented as a clean result — the one failure
 * mode this app is built to refuse.
 *
 * **`item` and `serial` are two kinds, and the difference is the whole point.**
 * `Item` is genuinely ambiguous: on one sheet it numbers the rows, on another
 * it holds the cable. `S/N`, `Sr No` and `Serial` are not ambiguous at all —
 * they are row numbers, always. Only the ambiguous one is eligible for the
 * description fallback below. Collapsing them into a single kind reopened the
 * defect through a second door: `S/N | Qty | Unit` scored as a readable table
 * and produced `1 — 12,500 m` again, which is where this started.
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
  ],
  /** Ambiguous: may number the rows, may hold the cable. */
  item: ['item', 'items'],
  /** Never a description. A sheet with only these has no cable text in it. */
  serial: ['item no', 'sn', 's/n', 'sr', 'sr no', 'sl no', 'serial', 'no'],
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

  /*
    Every row, not the first thirty.

    The cap said "past that it is a second table, not a late header", but the
    grid it scans is every sheet of the workbook laid end to end. A covering
    letter on sheet 1 of thirty-five rows put the schedule's header at grid
    index 38, and the file came back with no lines and `unreadable: true` — the
    exact workbook the reader's own comment claims to handle.

    Dropping the cap costs nothing the cap was buying. `score > best.score` is
    strictly greater, so the *first* best-scoring row still wins, and 4 is the
    maximum score — a genuine second table can never displace the first.
  */
  for (let i = 0; i < grid.length; i++) {
    const columns = (grid[i] ?? []).map(classifyHeader);
    // `serial` deliberately does not count. A sheet headed `S/N | Qty | Unit`
    // holds no cable text at all, and scoring it as a table is what turns row
    // numbers into descriptions.
    const hasText = columns.includes('description') || columns.includes('item');
    const score = (hasText ? 2 : 0) + (columns.includes('quantity') ? 2 : 0);
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
export function extractFromGrid(
  grid: Grid,
  regions: readonly TextRegion[] = [],
): ExtractedDocument {
  // One raw line per grid row, index-aligned, which is what lets a source
  // region point at a row number and have it mean something.
  const rawText = grid.map((r) => r.join('\t')).join('\n');
  const header = findHeaderRow(grid);

  if (header === null) {
    return {
      lines: [],
      sources: [],
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

  /*
    A real description column wins over a serial one, wherever each sits.
    `Item | Description | Qty` reads column 1, not column 0.
  */
  const namedAt = col('description');
  const descriptionAt = namedAt >= 0 ? namedAt : col('item');
  const quantityAt = col('quantity');
  const unitAt = col('unit');

  const lines: string[] = [];
  const sources: SourceRegion[] = [];
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
        `${placeOf(regions, i, 'row')}: “${description.slice(0, 60)}” has no ` +
          'readable quantity' +
          (quantityCell === '' ? '' : ` (found “${quantityCell}”)`),
      );
      continue;
    }

    const unit = unitAt >= 0 ? fold(row[unitAt] ?? '') : '';
    const metres = unit.startsWith('k') ? String(Number(quantity) * 1000) : quantity;

    lines.push(`${description} — ${Number(metres).toLocaleString('en-GB')} m`);
    sources.push({ line: i, where: placeOf(regions, i, 'row') });
  }

  const notes = [
    `Read ${lines.length} line${lines.length === 1 ? '' : 's'} from a table ` +
      `starting at ${placeOf(regions, header.index, 'row')}.`,
    // Said out loud, because it is a judgement rather than a reading. A sheet
    // with no column headed "description" may be one where "Item" holds the
    // cable, or one where the descriptions are somewhere this cannot see.
    ...(namedAt >= 0
      ? []
      : [
          'No column was headed “description”, so the cables were read from ' +
            'the “item” column. Check the lines below are cable descriptions ' +
            'and not row numbers.',
        ]),
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

  return { lines, sources, notes, unreadable: lines.length === 0, rawText };
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
export function extractFromText(
  text: string,
  regions: readonly TextRegion[] = [],
): ExtractedDocument {
  /*
    Blank lines are dropped, so two indices exist and must not be confused: the
    line's position in the file, which is what `regions` are drawn over, and
    its position in `rawText`, which is what the source view scrolls to. `at`
    keeps the first so the second can be translated back.
  */
  const all = text
    .split('\n')
    .map((l, at) => ({ text: l.replace(/\s+/g, ' ').trim(), at }))
    .filter((l) => l.text !== '');

  const kept = all
    .map((l, index) => ({ ...l, index }))
    .filter((l) => looksLikeCableLine(l.text));

  const lines = kept.map((l) => l.text);

  if (lines.length === 0) {
    return {
      lines: [],
      sources: [],
      notes: [
        all.length === 0
          ? 'No text could be read from this PDF. It is most likely a scan — ' +
            'this app does not read images, deliberately, because a misread ' +
            'digit is a wrong price. Paste the lines in instead.'
          : 'Text was read, but no line carried both a cable description and a ' +
            'quantity. The whole text is below — paste the cable lines in by hand.',
      ],
      unreadable: true,
      rawText: all.map((l) => l.text).join('\n'),
    };
  }

  return {
    lines,
    sources: kept.map((l) => ({
      line: l.index,
      where: placeOf(regions, l.at, 'line'),
    })),
    notes: [
      `Read ${lines.length} cable line${lines.length === 1 ? '' : 's'} from ${all.length} lines of text.`,
      'Lines without both a cable description and a quantity were left out. ' +
        'Check the extracted text against the document before approving.',
    ],
    unreadable: false,
    rawText: all.map((l) => l.text).join('\n'),
  };
}
