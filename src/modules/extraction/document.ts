/**
 * What a read document *is*, independent of how it was read.
 *
 * A spreadsheet, a PDF read by pattern, and a PDF read by the model all end in
 * the same shape, and all three need the same two things: a way to say where a
 * line came from, and a way to turn a page of text into numbered lines. Those
 * live here so the three readers cannot drift apart on what a "line 12" is.
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
export function placeOf(
  regions: readonly TextRegion[],
  index: number,
  unit: 'row' | 'line',
): string {
  const region = regions.find((r) => index >= r.from && index < r.to);
  if (region === undefined) return `${unit} ${index + 1}`;
  return `${region.name}, ${unit} ${index + 1 - region.from}`;
}

/** One entry per non-blank line of a page of text. */
export interface TextLine {
  /** Whitespace collapsed. */
  readonly text: string;
  /** Its index in the original text — what `regions` are drawn over. */
  readonly at: number;
}

/**
 * Blank lines dropped, so two indices exist and must not be confused: the
 * line's position in the file, which is what `regions` are drawn over, and its
 * position in `rawText`, which is what the source view scrolls to. `at` keeps
 * the first so the second can be translated back.
 */
export function textLines(text: string): readonly TextLine[] {
  return text
    .split('\n')
    .map((l, at) => ({ text: l.replace(/\s+/g, ' ').trim(), at }))
    .filter((l) => l.text !== '');
}
