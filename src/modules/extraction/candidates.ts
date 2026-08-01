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
  readonly evidence?: readonly string[];
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
export function schemaFor(terms: readonly Term[] = BUILT_IN_TERMS): Record<string, unknown> {
  const axisField = (axis: Axis) => ({
    type: ['string', 'null'],
    enum: [...new Set(terms.filter((t) => t.axis === axis).map((t) => t.canonical)), null],
    description:
      `The ${axis} of this cable, if the document states it — in the heading ` +
      'above the row as often as on the row itself. Null if it is not stated.',
  });

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
            quantityUnit: {
              type: ['string', 'null'],
              enum: ['m', 'km', null],
              description:
                'The unit that length is in. Use the table’s unit column when the ' +
                'row itself is blank. Null if nothing states it.',
            },
            ...Object.fromEntries(AXES.map((a) => [a, axisField(a)])),
            evidence: {
              type: 'array',
              items: { type: 'string' },
              description:
                'The text you read this row from, copied character for character: ' +
                'the row itself, and the heading above it when the construction ' +
                'came from there. Each entry must be one unbroken run of text as ' +
                'printed — quote several short runs rather than stitching one long ' +
                'one together.',
            },
          },
        },
      },
    },
  };
}

export const INSTRUCTIONS =
  'You are reading a cable enquiry that a customer has sent to a cable ' +
  'manufacturer, so that it can be quoted. The text below was taken out of a ' +
  'PDF and has lost its table structure: columns may have come apart, and a ' +
  'row’s description and its quantity may sit on separate lines.\n\n' +
  'List every cable the customer is asking to have priced.\n\n' +
  'These documents are usually hierarchical. A heading describes a ' +
  'construction in prose — voltage, conductor, insulation, armour, sheath — ' +
  'and the numbered rows beneath it give only cores, size and quantity. Those ' +
  'rows inherit the heading above them: repeat the heading’s construction on ' +
  'every row it governs, and stop at the next heading. Working out which ' +
  'heading governs which rows is the job.\n\n' +
  'Rules, in order of importance:\n\n' +
  '1. Copy, never calculate. Every number you give must be printed in the ' +
  'document. Do not convert units, do not round, do not total rows, and do not ' +
  'fill a gap in a numbering sequence with a row that is not there.\n' +
  '2. If you are not certain of a field, return null for it. A missing field ' +
  'costs an engineer thirty seconds; a wrong one leaves this building as a ' +
  'price. This is not a test of how much you can fill in.\n' +
  '3. Quote your source in `evidence`, character for character. Anything you ' +
  'have not quoted will be discarded.\n' +
  '4. Leave out anything that is not a cable being asked for: title blocks, ' +
  'revision tables, drum-length notes, core-colour notes, totals.\n' +
  '5. Documents contain mistakes. Do not correct them and do not drop the row — ' +
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

    const quotes = (candidate.evidence ?? []).filter(
      (q): q is string => typeof q === 'string' && q.trim() !== '',
    );

    // Rule 1: what was not quoted from the document did not come from it.
    const unquoted = quotes.filter((q) => !whole.includes(oneLine(q).toLowerCase()));
    if (quotes.length === 0 || unquoted.length > 0) {
      refused.push(
        `${ref} was left out — ` +
          (quotes.length === 0
            ? 'nothing in the document was quoted in support of it.'
            : `“${oneLine(unquoted[0] ?? '').slice(0, 60)}” does not appear in the document.`),
      );
      continue;
    }

    const evidence = quotes.join(' \n ');

    // Rule 2: a number that is not printed is not a number.
    const size = positive(candidate.sizeMm2);
    if (size === null || !statesNumber(evidence, size)) {
      refused.push(`${ref} was left out — no conductor size is printed in the text it cites.`);
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
    if (quantity === null || !statesNumber(evidence, quantity)) {
      refused.push(
        `${ref} was left out — no quantity is printed in the text it cites, and ` +
          'a quantity is not worth guessing at.',
      );
      continue;
    }

    /*
      Kilometres are accepted only when the text says kilometres. Every other
      field failing costs a little precision; this one failing multiplies an
      order by a thousand, so it is the one claim checked against the words
      rather than taken on trust.

      And when the claim is refused, it is refused *out loud*. Silently reading
      it as metres is safe only if the model was wrong. If the document really
      does print kilometres in a form this does not recognise — `Kms.`, `K.M.`
      — then the quote goes out at a thousandth of the length, under a note
      saying nothing was converted. That is the one shape of mistake this whole
      file exists to prevent, and it would have been introduced by the check
      meant to prevent it.
    */
    const saysKm = /\bkms?\b/i.test(evidence);
    if (candidate.quantityUnit === 'km' && !saysKm) {
      doubted.push(
        `${ref} was read in metres. Kilometres were claimed for it, and the text ` +
          'it cites does not say kilometres — check the unit against the document ' +
          'before this one is priced.',
      );
    }
    const metres = candidate.quantityUnit === 'km' && saysKm ? quantity * 1000 : quantity;

    // Rule 3: the term the model chose, looked for in the words it quoted.
    const spec = AXES.map((axis) => verifiedTerm(terms, axis, candidate[axis], evidence)).filter(
      (t): t is string => t !== null,
    );

    const cores = positive(candidate.cores);
    const head =
      cores !== null && Number.isInteger(cores) && statesNumber(evidence, cores)
        ? `${cores}C x ${num(size)} mm²`
        : `${num(size)} mm²`;

    const at = lineOf(folded, quotes, size, quantity);
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
  };
}

/** Whitespace collapsed, so a quote matches text the PDF reader already folded. */
const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();

/**
 * Which line of the document this row came off.
 *
 * The quote carrying the quantity is the anchor, because the quantity is the
 * rightmost thing on a row: a quote containing it is the row itself rather
 * than the heading three lines above it, which every row in a group quotes and
 * which would otherwise send half a schedule to the same place.
 *
 * Anchoring on the *numbers* instead was tried and is worse than it looks. A
 * schedule repeats them — 850 metres of 240 mm² appears twice in the RFQ this
 * was built for, once under an MV heading and once under an LV one — so
 * "the line stating both" confidently picked the wrong row. Text a model
 * copied off a row is far more distinguishing than the figures on it.
 */
function lineOf(
  folded: readonly string[],
  quotes: readonly string[],
  size: number,
  quantity: number,
): number {
  const at = (quote: string) => folded.findIndex((l) => l.includes(oneLine(quote).toLowerCase()));

  for (const test of [
    (q: string) => statesNumber(q, quantity),
    (q: string) => statesNumber(q, size),
    () => true,
  ]) {
    for (const quote of quotes) {
      if (!test(quote)) continue;
      const found = at(quote);
      if (found >= 0) return found;
    }
  }
  return 0;
}
