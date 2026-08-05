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

/**
 * What an upload becomes: an enquiry, or a refusal.
 *
 * A document nobody could read opens with no lines, not with all of them. It
 * used to become the enquiry — the whole text was handed on as `rawText`, and
 * since the review screen reads one cable per line, a four-page MTO arrived as
 * 140 Partial lines: title block, revision table, page footers and all. The
 * engineer was handed something that looked like an enquiry of a hundred and
 * forty cables and was in fact an enquiry of none.
 *
 * The text is not lost either way. It goes where the text of a readable
 * document goes — beside the job, where the source view already shows it and
 * where it can be read from and pasted. What changes is that the app stops
 * claiming those lines are cables.
 *
 * **It lives here rather than in the action that calls it.** It is three lines
 * of policy, it was written in a Server Action, and a Server Action cannot be
 * put under test without standing up a session, four repositories and the
 * router. So the one decision worth checking sat where nothing could check it,
 * and it shipped wrong once already. Here it is an argument and a return
 * value.
 */
export function enquiryFrom(
  read: ExtractedDocument,
): { readonly rawText: string } | { readonly refusal: string } {
  if (read.lines.length > 0) return { rawText: read.lines.join('\n') };
  if (read.rawText.trim() !== '') return { rawText: '' };
  /*
    Nothing read and nothing to show. The notes are the only diagnosis there
    is — "no text could be read from this PDF, it is most likely a scan" — so
    the first of them is the refusal rather than a generic sentence that throws
    away what the reader worked out.
  */
  return { refusal: read.notes[0] ?? 'Nothing could be read from that file.' };
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
