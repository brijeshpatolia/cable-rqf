import { type Axis, type Term, BUILT_IN_TERMS, fold } from '@/modules/matching';
import {
  type ExtractedDocument,
  type SourceRegion,
  type TextRegion,
  placeOf,
  textLines,
} from './document';

/**
 * Reading a document's *layout* with a model, and nothing else.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 *
 * The pattern reader in `index.ts` keeps any line carrying a cable shape and a
 * quantity. That works on a flat schedule and fails completely on the
 * commonest MTO layout in the region, which is hierarchical: a group heading
 * describes the construction in a paragraph of prose —
 *
 *     600/1000V, STRANDED ANNEALED PLAIN COPPER CONDUCTOR, XLPE INSULATION,
 *     EXTRUDED PVC BEDDING, GALVANIZED STEEL ROUND WIRE ARMOUR AND OVERALL
 *     EXTRUDED PVC OUTER SHEATH
 *
 * — and thirty numbered sub-items beneath it carry only `5.1 2C X 16 mm² m
 * 19000`. Every fact that decides the price is one paragraph up from the line
 * that needs it, and nothing in the text says how far up.
 *
 * On the customer RFQ this was built against, the pattern reader read **no
 * lines at all** — forty-seven cables in the document and nothing on the
 * screen. Two reasons, and both are the same reason: the unit is printed
 * *before* the figure, `m 19000`, which is not a quantity as far as that
 * reader is concerned, and about a quarter of the rows had their description
 * and their quantity land on separate lines when the columns came apart. Read
 * the same text this way and forty-five of the cables come back, twenty-seven
 * of them matching a costed item code exactly.
 *
 * Associating a heading with the rows beneath it is a layout judgement. It is
 * the one part of this job a model is genuinely better at than a regular
 * expression, and it is also the only part this file lets it do.
 *
 * ── What the model is not allowed to do ────────────────────────────────────
 *
 * From the project plan: *"The model never touches pricing, never touches
 * matching, and never fills a field it isn't certain of. It converts layout
 * into candidate fields; determinism resumes immediately after."* That is
 * enforced here rather than asked for politely:
 *
 * 1. **Every answer must be quoted.** Each candidate cites the verbatim
 *    excerpts it was read from, and an excerpt that does not appear in the
 *    document costs the whole line. A model that invents a row cannot get it
 *    past this.
 * 2. **Every number must appear in what it quoted.** A quantity of 19,000 is
 *    accepted only if `19000` is a whole number sitting in the cited text. The
 *    model may find a figure; it may never compute or round one — and a wrong
 *    quantity is the single most expensive mistake this app can make.
 * 3. **Every spec term must be found in the words it quoted.** The model
 *    answers with one of Nuhas's own canonical terms — it cannot invent
 *    vocabulary, because the schema is built from the dictionary — and the
 *    term is then looked for in the text it cited. `SWA` survives only if that
 *    text really does say steel wire armour somewhere. This catches a term
 *    conjured out of nothing; it cannot catch a term read off the wrong
 *    paragraph, and does not claim to.
 * 4. **Anything that fails is dropped, and said out loud.** A failed field
 *    becomes empty, which the matcher already handles by refusing to price and
 *    asking a person. A failed row is listed in the notes with its item
 *    number, so nothing disappears quietly.
 *
 * The output is text in exactly the form a person would have pasted, which is
 * then parsed, matched and costed by the same deterministic code as always.
 * Nothing downstream of here knows a model was involved.
 */

/** The axes the model is asked to fill, in the order a cable is built. */
const AXES: readonly Axis[] = [
  'conductor',
  'insulation',
  'screen',
  'armour',
  'sheath',
  'voltage',
  'standard',
];

/** One row as the model returns it. Every field may be absent. */
export interface Candidate {
  readonly itemRef?: string | null;
  readonly cores?: number | null;
  readonly sizeMm2?: number | null;
  readonly quantity?: number | null;
  readonly quantityUnit?: string | null;
  readonly conductor?: string | null;
  readonly insulation?: string | null;
  readonly screen?: string | null;
  readonly armour?: string | null;
  readonly sheath?: string | null;
  readonly voltage?: string | null;
  readonly standard?: string | null;
  readonly evidence?: {
    /** This row's own cells: its number, description, unit and quantity. */
    readonly row?: readonly string[];
    /** The group heading it inherits its construction from. */
    readonly heading?: readonly string[];
  };
}

/**
 * The response schema, built from the dictionary rather than written out.
 *
 * Every spec axis is an enum of Nuhas's own terms, so "invented a plausible
 * cable spec" is not a failure mode anything downstream has to catch — the
 * request will not produce one. It is built at call time from the *current*
 * dictionary, which means a term the Rate Owner taught the app last week is
 * one the model is allowed to use today, with no code change.
 */
/**
 * A field that is one of a fixed set of words, or nothing.
 *
 * `anyOf`, not `{ type: ['string', 'null'], enum: [...] }`. The obvious
 * spelling is accepted by every JSON Schema validator and rejected by this
 * API with `Enum value 'm' does not match declared type '['string','null']'`:
 * it checks each enum member against the declared type as a whole rather than
 * against the union's branches. The two-branch form says the same thing in a
 * way it will take.
 *
 * It cost a 400 on the first live call to find, which is the entire argument
 * for having made one. Nothing short of a real request could have caught it —
 * the stub server this was tested against will accept any body at all.
 */
const oneOfOrNull = (values: readonly unknown[], description: string) => ({
  anyOf: [{ type: typeof values[0] === 'string' ? 'string' : 'number', enum: [...values] }, { type: 'null' }],
  description,
});

export function schemaFor(terms: readonly Term[] = BUILT_IN_TERMS): Record<string, unknown> {
  const axisField = (axis: Axis) =>
    oneOfOrNull(
      [...new Set(terms.filter((t) => t.axis === axis).map((t) => t.canonical))],
      `The ${axis} of this cable, if the document states it — in the heading ` +
        'above the row as often as on the row itself. Null if it is not stated.',
    );

  return {
    type: 'object',
    additionalProperties: false,
    required: ['lines'],
    properties: {
      lines: {
        type: 'array',
        description: 'One entry per cable the customer is asking to have priced.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: [
            'itemRef',
            'cores',
            'sizeMm2',
            'quantity',
            'quantityUnit',
            ...AXES,
            'evidence',
          ],
          properties: {
            itemRef: {
              type: ['string', 'null'],
              description: 'The row’s own number as printed, e.g. "5.12". Null if unnumbered.',
            },
            cores: {
              type: ['integer', 'null'],
              description:
                'Number of cores. A pair count is not a core count — leave this ' +
                'null rather than doubling it. Null if the row does not say.',
            },
            sizeMm2: {
              type: ['number', 'null'],
              description: 'Conductor cross-section in mm², exactly as printed.',
            },
            quantity: {
              type: ['number', 'null'],
              description:
                'The length asked for, exactly as printed — do not convert, ' +
                'round, or add rows together.',
            },
            quantityUnit: oneOfOrNull(
              ['m', 'km'],
              'The unit that length is in. Use the table’s unit column when the ' +
                'row itself is blank. Null if nothing states it.',
            ),
            ...Object.fromEntries(AXES.map((a) => [a, axisField(a)])),
            evidence: {
              type: 'object',
              additionalProperties: false,
              required: ['row', 'heading'],
              description:
                'Where you read this row, split into the part that is the row’s ' +
                'own and the part it inherits. The split is what lets the row be ' +
                'checked without guessing at the layout.',
              properties: {
                row: {
                  type: 'array',
                  items: { type: 'string' },
                  description:
                    'The text of THIS ROW’S OWN CELLS, copied character for ' +
                    'character: its number, its description, its unit, its ' +
                    'quantity. Nothing from any other row. Every figure you report ' +
                    'is looked for here, so a row whose cells you cannot quote is ' +
                    'a row that will be left out. If the cell holds a value that ' +
                    'has been struck through, quote that too — it is part of the ' +
                    'cell — but do not report it as the answer.',
                },
                heading: {
                  type: 'array',
                  items: { type: 'string' },
                  description:
                    'The group heading this row inherits its construction from, ' +
                    'copied character for character. Every line of it you took a ' +
                    'field from. Empty when the row states its own construction.',
                },
              },
            },
          },
        },
      },
    },
  };
}

export const INSTRUCTIONS =
  'You are reading a cable enquiry that a customer has sent to a cable ' +
  'manufacturer, so that it can be quoted. List every cable they are asking to ' +
  'have priced.\n\n' +
  'These documents are hierarchical. A heading describes a construction in ' +
  'prose — voltage, conductor, insulation, armour, sheath — and the numbered ' +
  'rows beneath it give only cores, size and quantity. Those rows inherit the ' +
  'heading above them: repeat its construction on every row it governs, and ' +
  'stop at the next heading.\n\n' +
  'Rules, in order of importance:\n\n' +
  '1. Copy, never calculate. Every number you give must be printed in the ' +
  'document. Do not convert units, do not round, do not total rows, and do not ' +
  'fill a gap in a numbering sequence with a row that is not there.\n' +
  '2. Read what is in force, not what was cancelled. These documents are marked ' +
  'up by hand. A value struck through has been withdrawn and must never be ' +
  'reported; the value written in beside it, often in another colour, is the one ' +
  'to price. If you cannot tell which of two values stands, return null for that ' +
  'field rather than choosing between them.\n' +
  '3. If you are not certain of a field, return null. A missing field costs an ' +
  'engineer thirty seconds; a wrong one leaves this building as a price. This is ' +
  'not a test of how much you can fill in.\n' +
  '4. Quote your source, character for character, in the two places provided. ' +
  '`evidence.row` is this row’s own cells and nothing from any other row; ' +
  '`evidence.heading` is the heading lines it inherits. Every figure you report ' +
  'is looked for in `evidence.row`, so a row you cannot quote is a row that will ' +
  'be left out. Always include the row’s own number as one of the entries in ' +
  '`evidence.row` — it is what ties the row to itself, and a row that does not ' +
  'quote its own number is left out. Add nothing of your own to a quote: no ' +
  'notes, no parentheses, no ellipses, no “(struck through)”. An annotated ' +
  'quote is not a quote and costs the row.\n' +
  '5. Include a row whose quantity is nought, exactly as printed. It is still ' +
  'something the customer put on the schedule and somebody should ask them about ' +
  'it; leaving it out silently is the one thing worse than leaving it in.\n' +
  '6. Leave out anything that is not a cable being asked for: title blocks, ' +
  'revision tables, drum-length notes, core-colour notes, totals.\n' +
  '7. Documents contain mistakes. Do not correct them and do not drop the row — ' +
  'report what is printed and let a person decide.';

/** `2.5` → `2.5`, `16` → `16`. Never `16.0`. */
function num(value: number): string {
  return String(Number(value.toFixed(4)));
}

/**
 * Does this text state that number, as a number?
 *
 * Substring matching would accept the `1` in `7.1` as a core count and the
 * `240` in `1240` as a size. So the text is cut into numeric tokens and
 * compared by value: `19,000` and `19000` are the same number, `7.1` is not
 * `1`, and `2.5` is not `25`.
 */
export function statesNumber(text: string, value: number): boolean {
  return text
    .replace(/,/g, '')
    .split(/[^0-9.]+/)
    .some((token) => {
      const trimmed = token.replace(/^\.+|\.+$/g, '');
      return trimmed !== '' && Number(trimmed) === value;
    });
}

/**
 * Words, for phrase matching.
 *
 * `fold` is the dictionary's own normaliser and is used unchanged so the two
 * cannot disagree, but it leaves commas and brackets in place — and the
 * document says `600/1000V, MULTI-STRANDED…`, where a trailing comma is the
 * difference between recognising the voltage and not. A slash is kept, because
 * `600/1000v` is one word and splitting it makes it two meaningless ones.
 */
function wordsOf(text: string): readonly string[] {
  return fold(text)
    .split(/[^a-z0-9/²]+/)
    .filter((w) => w !== '');
}

/**
 * Does this text contain that phrase, allowing words in between?
 *
 * The dictionary holds `steel wire armour`; the document says `GALVANIZED
 * STEEL ROUND WIRE ARMOUR`. Requiring an exact run of words would reject
 * almost every spec term in a real MTO, and accepting the words in any
 * position would let a paragraph mentioning steel, and forty words later
 * armour, count as SWA. So the words must appear in order and close together —
 * the room allowed for extra words is as many again as the phrase has, plus
 * two.
 */
export function containsPhrase(text: string, phrase: string): boolean {
  const words = wordsOf(text);
  const wanted = wordsOf(phrase);
  if (wanted.length === 0) return false;

  const window = wanted.length * 2 + 2;

  for (let start = 0; start < words.length; start++) {
    if (words[start] !== wanted[0]) continue;
    let at = start + 1;
    let next = 1;
    while (next < wanted.length && at < words.length && at - start < window) {
      if (words[at] === wanted[next]) next++;
      at++;
    }
    if (next === wanted.length) return true;
  }
  return false;
}

/** A term the model chose, kept only if the text it quoted uses that word. */
function verifiedTerm(
  terms: readonly Term[],
  axis: Axis,
  answer: string | null | undefined,
  evidence: string,
): string | null {
  if (typeof answer !== 'string' || answer.trim() === '') return null;
  const wordings = terms
    .filter((t) => t.axis === axis && t.canonical === answer)
    .flatMap((t) => [t.canonical, ...t.synonyms]);
  if (wordings.length === 0) return null;
  return wordings.some((w) => containsPhrase(evidence, w)) ? answer : null;
}

/**
 * A number this app can act on, or nothing.
 *
 * Zero is deliberately not one. A zero size is meaningless and a zero quantity
 * is a question for the customer, and both arrive often enough in real
 * documents that letting them through as "a number" would put an unpriceable
 * line on screen with nothing said about why.
 */
function positive(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

export interface CandidateReading {
  readonly document: ExtractedDocument;
  /** How many rows the model offered, before any were refused. */
  readonly offered: number;
  /**
   * Why each refused row was refused, and each doubt about a kept one.
   *
   * Named rather than left to be sliced off the front of `notes`, because a
   * caller that wants the reasons without the summary was reaching in by index
   * and would have taken the wrong one the day a note was added.
   */
  readonly reasons: readonly string[];
}

/**
 * The model's answer, checked against the document it claims to have read.
 *
 * Pure, and deliberately so: every rule about what is trustworthy is here,
 * where a test can put a lie in front of it and watch it be refused. The
 * network call lives in `infra/extraction` and knows none of this.
 */
export function readCandidates({
  candidates,
  text,
  regions = [],
  terms = BUILT_IN_TERMS,
}: {
  readonly candidates: readonly Candidate[];
  readonly text: string;
  readonly regions?: readonly TextRegion[];
  readonly terms?: readonly Term[];
}): CandidateReading {
  const all = textLines(text);
  const rawText = all.map((l) => l.text).join('\n');
  const folded = all.map((l) => l.text.toLowerCase());
  /*
    One string, so a quote that runs across a line break still matches. The
    heading this whole file exists to read is three lines long in the extracted
    text and has a row number sitting in the middle of it, so a quote confined
    to one line would be a quote of almost nothing.
  */
  const whole = folded.join(' ');

  /*
    Every row number the answer claims, so a row can be checked for cells that
    are not its own. The split evidence buys simplicity by trusting the model's
    grouping; this is the one place that trust is checked, and it is checked
    with information the answer supplies about itself.
  */
  const everyRef = new Set(
    candidates
      .map((c) => (typeof c.itemRef === 'string' ? c.itemRef.trim() : ''))
      .filter((r) => r !== ''),
  );

  const lines: string[] = [];
  const sources: SourceRegion[] = [];
  const refused: string[] = [];
  /** Rows that were kept, but with something about them worth saying. */
  const doubted: string[] = [];

  for (const candidate of candidates) {
    const numbered =
      typeof candidate.itemRef === 'string' && candidate.itemRef.trim() !== ''
        ? candidate.itemRef.trim()
        : null;
    const ref = numbered === null ? 'An unnumbered row' : `Item ${numbered}`;

    const clean = (q: readonly string[] | undefined) =>
      (q ?? []).filter((x): x is string => typeof x === 'string' && x.trim() !== '');
    const row = clean(candidate.evidence?.row);
    const heading = clean(candidate.evidence?.heading);

    // Rule 1: what was not quoted from the document did not come from it.
    const unquoted = [...row, ...heading].filter((q) => !isQuoted(whole, rawText, q));
    if (row.length === 0 || unquoted.length > 0) {
      refused.push(
        `${ref} was left out — ` +
          (row.length === 0
            ? 'none of its own cells were quoted from the document.'
            : `“${oneLine(unquoted[0] ?? '').slice(0, 60)}” does not appear in the document.`),
      );
      continue;
    }

    /*
      The row's own cells, and separately everything it cites.

      Figures are looked for in the first and construction terms in the second,
      which is the whole reason the model is asked to split them. It replaced
      three rounds of line-distance rules — a window, a proximity fallback, a
      row-number join — each of which existed only to guess at which lines
      belonged to a row, and each of which was wrong in a different way. A model
      looking at the page does not have to guess.
    */
    const cells = row.join(' \n ');
    const cited = [...row, ...heading].join(' \n ');

    // Rule 2: a number that is not printed on this row is not this row's number.
    const size = positive(candidate.sizeMm2);
    if (size === null || !statesNumber(cells, size)) {
      refused.push(`${ref} was left out — no conductor size is printed in its own cells.`);
      continue;
    }

    if (candidate.quantity === 0) {
      refused.push(
        `${ref} was left out — the quantity printed against it is nought. ` +
          'Ask the customer what they want before pricing it.',
      );
      continue;
    }

    const quantity = positive(candidate.quantity);
    if (quantity === null || !statesNumber(cells, quantity)) {
      refused.push(
        `${ref} was left out — no quantity is printed in its own cells, and a ` +
          'quantity is not worth guessing at.',
      );
      continue;
    }

    /*
      The row number has to be in the row's own cells.

      Without this, a row numbered 5.1 could be built entirely out of 5.2's
      cell: every figure printed, on one line, in the right document, and only
      the number saying otherwise. It was found in review the first time and it
      costs one line to keep out.
    */
    if (numbered !== null && !row.some((q) => statesRef(q, numbered))) {
      refused.push(
        `${ref} was left out — none of the cells it quotes carry that row number, ` +
          'so there is nothing tying what was read to the row it claims to be.',
      );
      continue;
    }

    /*
      And none of the cells may belong to a different row.

      Two intact rows at the same size are enough to build a fiction out of
      true statements — quote 5.2's cell under 5.1's number and every figure is
      printed, on one line, in the right document. Found in review when the
      layout was being reconstructed from line distances, and it does not stop
      being possible now that the model reports the grouping instead.
    */
    const intruder =
      row.map((q) => leadingRef(q)).find((r) => r !== null && r !== numbered) ??
      [...everyRef].find((other) => other !== numbered && row.some((q) => statesRef(q, other)));
    if (intruder !== undefined) {
      refused.push(
        `${ref} was left out — it quotes a cell belonging to item ${intruder}, so ` +
          'what was read is not all one row. Read that row off the file by hand.',
      );
      continue;
    }

    /*
      Kilometres are accepted only when the row says kilometres. Every other
      field failing costs a little precision; this one failing multiplies an
      order by a thousand.
    */
    /*
      No leading word boundary: the unit is printed against the figure as often
      as beside it, and `3.75km` has no boundary between the 5 and the k. With
      one, that row was read as 3.75 metres.
    */
    const saysKm = /kms?\b/i.test(cells);
    if (candidate.quantityUnit === 'km' && !saysKm) {
      doubted.push(
        `${ref} was read in metres. Kilometres were claimed for it, and its own ` +
          'cells do not say kilometres — check the unit against the document ' +
          'before this one is priced.',
      );
    }
    const metres = candidate.quantityUnit === 'km' && saysKm ? quantity * 1000 : quantity;

    // Rule 3: the term the model chose, looked for in the words it quoted.
    const spec = AXES.map((axis) => verifiedTerm(terms, axis, candidate[axis], cited)).filter(
      (t): t is string => t !== null,
    );

    const cores = positive(candidate.cores);
    const head =
      cores !== null && Number.isInteger(cores) && statesNumber(cells, cores)
        ? `${cores}C x ${num(size)} mm²`
        : `${num(size)} mm²`;

    const at = lineOf(folded, row, quantity);
    lines.push(`${[head, ...spec].join(' ')} — ${metres.toLocaleString('en-GB')} m`);
    sources.push({
      line: at,
      where:
        placeOf(regions, all[at]?.at ?? 0, 'line') + (numbered === null ? '' : `, item ${numbered}`),
    });
  }

  const notes = [
    `Read ${lines.length} cable line${lines.length === 1 ? '' : 's'} from ` +
      `${all.length} lines of text, by following the document’s headings down ` +
      'onto the rows beneath them.',
    'Every figure above is printed in the document — nothing was converted, ' +
      'rounded or totalled — and every construction term was looked for in the ' +
      'words it was read from. Whatever failed either check was left empty for ' +
      'you to settle rather than filled in.',
    ...doubted,
    ...(refused.length === 0
      ? []
      : [
          `${refused.length} row${refused.length === 1 ? ' was' : 's were'} left out:`,
          ...refused.slice(0, 8),
          ...(refused.length > 8 ? [`…and ${refused.length - 8} more.`] : []),
        ]),
  ];

  return {
    document: { lines, sources, notes, unreadable: lines.length === 0, rawText },
    offered: candidates.length,
    reasons: [...doubted, ...refused],
  };
}

/** Whitespace collapsed, so a quote matches text the PDF reader already folded. */
const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();

/**
 * The row number a cell opens with, if it opens with one.
 *
 * `5.2 3C X 2.5 mm² m 4000` is numbered 5.2; `3750` is a quantity and `2C X 4
 * mm²` is a description, and neither is numbered at all. The pattern wants a
 * number, then a space, then something that is not a unit.
 *
 * The unit is the whole difficulty. `6 mm² Y/G CABLE` is how the earthing
 * cables are written — a number, a space, and content — and reading its `6` as
 * a row number would have refused all six of them for belonging to somebody
 * else. A figure followed by `mm²` is a size; a figure followed by anything
 * else is a row that has been numbered.
 *
 * This is here because the other half of the check reads the row numbers off
 * the *answer*, and an answer that omits a row omits its number too: quote
 * 5.1's number cell and 5.2's quantity, leave 5.2 out of the reply, and
 * nothing in a set built from the reply knows 5.2 exists. Raised in review.
 * Read off the cell itself, it does not matter what else the model chose to
 * report.
 */
const LEADING_REF = /^\s*['"’]?\s*(\d+(?:\.\d+)?)\s+(?!(?:mm|sq|m|km|metres?|meters?)\b)\S/i;

function leadingRef(text: string): string | null {
  return LEADING_REF.exec(oneLine(text))?.[1] ?? null;
}

/** Is this text's own row number `ref` — as a whole word, not a digit inside one? */
function statesRef(text: string, ref: string): boolean {
  return oneLine(text)
    .split(' ')
    .some((token) => token.replace(/^[^0-9a-z]+|[^0-9a-z]+$/gi, '') === ref);
}

/**
 * Was this excerpt really taken from the document?
 *
 * Verbatim first, which is what an honest quote of a cell looks like. Failing
 * that, the same words in order and close together — because a heading quoted
 * the way a person reads it is often *not* a substring of the text layer. The
 * columns come apart in extraction and drop a row number into the middle of
 * the sentence:
 *
 *     600/1000V, STRANDED ANNEALED … BINDER TAPE (AS
 *     5
 *     REQUIRED), EXTRUDED PVC BEDDING, GALVANIZED STEEL …
 *
 * The first run of this against a real PDF rejected every heading in the
 * document on exactly that, and kept six lines out of forty-five. Words in
 * order within a window is still a check nothing invented can pass: a
 * fabricated heading would have to appear, word for word and in sequence, in
 * text it never came from.
 */
function isQuoted(whole: string, rawText: string, quote: string): boolean {
  return whole.includes(oneLine(quote).toLowerCase()) || containsPhrase(rawText, quote);
}

/**
 * Which line of the document this row came off.
 *
 * The cell carrying the quantity, because the quantity is the rightmost thing
 * on a row: a cell containing it is the row itself rather than the heading
 * above it, which every row in a group quotes and which would otherwise send
 * half a schedule to the same place.
 *
 * Every occurrence of a quote counts, not the first. `3C X 185 mm²` sits
 * inside item 3.3's row and again on its own as the top half of item 5.7
 * thirty lines later, and taking the first would open the source view on the
 * wrong row.
 */
function lineOf(folded: readonly string[], row: readonly string[], quantity: number): number {
  const at = (quote: string) => folded.findIndex((l) => l.includes(oneLine(quote).toLowerCase()));

  /*
    Longest first, and nothing trivially short.

    A cell quoted on its own is often a single token — `m`, `3750`, `5.3` —
    and `m` is in every line of the document. Anchoring on the first one
    offered sent a third of the schedule to whichever line happened to come
    first, so the source view opened on a row the engineer had not asked
    about. The longest quote is the one that identifies a place.
  */
  const longestFirst = (qs: readonly string[]) =>
    [...qs].sort((a, b) => oneLine(b).length - oneLine(a).length);
  const distinctive = longestFirst(row.filter((q) => oneLine(q).length >= 6));

  const carriesQuantity = (q: string) => statesNumber(q, quantity);
  // The short cells last, because `5.3` and `m 0` still place a row better
  // than line 0 does — line 0 is the document's first heading.
  for (const [quotes, test] of [
    [distinctive, carriesQuantity],
    [distinctive, () => true],
    [longestFirst(row), carriesQuantity],
    [longestFirst(row), () => true],
  ] as const) {
    for (const quote of quotes) {
      if (!test(quote)) continue;
      const found = at(quote);
      if (found >= 0) return found;
    }
  }
  return 0;
}
