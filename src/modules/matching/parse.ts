import { type Decimal, dec } from '@/core/decimal';
import { type Axis, type Dictionary, BUILT_IN_DICTIONARY, fold } from './vocabulary';

/**
 * Turns one RFQ line — however the customer worded it — into structured
 * fields, with a record of where each one came from.
 *
 * The controlling rule: **anything ambiguous comes back empty and flagged,
 * never guessed.** An empty field costs the engineer a moment; a wrong field
 * costs the margin on the order.
 *
 * This is deterministic token matching, not a model. Phase 3 puts document
 * extraction in front of it; the output shape does not change.
 */

export interface ExtractedField<T> {
  readonly value: T | null;
  /** The exact substring this came from. Empty when nothing matched. */
  readonly sourceText: string;
}

export interface ExtractedLine {
  readonly raw: string;
  readonly cores: ExtractedField<number>;
  readonly sizeMm2: ExtractedField<Decimal>;
  readonly quantityMetres: ExtractedField<Decimal>;
  readonly conductor: ExtractedField<string>;
  readonly insulation: ExtractedField<string>;
  readonly screen: ExtractedField<string>;
  readonly armour: ExtractedField<string>;
  readonly sheath: ExtractedField<string>;
  readonly voltage: ExtractedField<string>;
  readonly standard: ExtractedField<string>;
  /**
   * Phrases that look like spec terms but aren't in the dictionary. The job
   * pauses on these and asks; the answer is saved to the dictionary.
   */
  readonly unknownTerms: readonly string[];
}

const empty = <T>(): ExtractedField<T> => ({ value: null, sourceText: '' });
const found = <T>(value: T, sourceText: string): ExtractedField<T> => ({
  value,
  sourceText,
});

/**
 * `3C x 50mm2`, `3 x 50 sq mm`, `4Cx16`, `10Pair x 1.5mm2`.
 * A pair count is doubled into cores, which is what the library holds.
 */
const CORES_SIZE =
  /(\d+)\s*(?:c|core|cores|pr|pair|pairs)?\s*[x×*]\s*(\d+(?:\.\d+)?)\s*(?:sq\.?\s*)?(?:mm2|mm²|mm\^2|mm)?/i;

/** A bare size with no core count: `50mm2`. */
const SIZE_ONLY = /(\d+(?:\.\d+)?)\s*(?:sq\.?\s*)?(?:mm2|mm²|mm\^2)/i;

/** `12,000 m`, `12000 metres`, `2.5 km`. */
const QUANTITY = /(\d[\d,]*(?:\.\d+)?)\s*(k?m|metres?|meters?|kms?)\b/i;

const PAIR_WORDS = /(?:pr|pair|pairs)/i;

/** A dictionary phrase found in the text, with where it sat and what it could mean. */
interface Occurrence {
  readonly start: number;
  readonly end: number;
  readonly phrase: string;
  /** Axis → canonical term. A phrase like "PVC" resolves on two axes. */
  readonly byAxis: ReadonlyMap<Axis, string>;
}

const ALL_AXES: readonly Axis[] = [
  'conductor',
  'insulation',
  'screen',
  'armour',
  'sheath',
  'voltage',
  'standard',
];

/**
 * @param dictionary Defaults to the terms that ship with the app. The Rate
 * Owner's learned terms are merged in by the caller, so this function stays
 * pure and a test can pin the vocabulary it parses against.
 */
export function parseLine(
  raw: string,
  dictionary: Dictionary = BUILT_IN_DICTIONARY,
): ExtractedLine {
  const text = raw.trim();

  // ── Quantity, taken first so its digits don't get read as a size ──────
  let quantity = empty<Decimal>();
  let specText = text;

  const qty = QUANTITY.exec(text);
  if (qty !== null) {
    const amount = dec(qty[1]!.replace(/,/g, ''));
    const unit = qty[2]!.toLowerCase();
    const metres = unit.startsWith('k') ? amount.times(1000) : amount;
    quantity = found(metres, qty[0]);
    specText = text.replace(qty[0], ' ');
  }

  // ── Cores and size ───────────────────────────────────────────────────
  let cores = empty<number>();
  let size = empty<Decimal>();

  const cs = CORES_SIZE.exec(specText);
  if (cs !== null) {
    const count = Number(cs[1]);
    // "10Pair" is 20 cores. The library counts cores, not pairs.
    const isPairs = PAIR_WORDS.test(cs[0]);
    cores = found(isPairs ? count * 2 : count, cs[0]);
    size = found(dec(cs[2]!), cs[0]);
  } else {
    const sizeOnly = SIZE_ONLY.exec(specText);
    if (sizeOnly !== null) size = found(dec(sizeOnly[1]!), sizeOnly[0]);
  }

  // ── Vocabulary, read positionally ────────────────────────────────────
  const folded = fold(text);
  const occurrences = findOccurrences(folded, dictionary);

  /**
   * A cable designation is written in build order: conductor, insulation,
   * screen, armour, sheath. PVC appears on both the insulation and sheath
   * axes, so the two are told apart by *where* they sit, not by the word —
   * the first PVC is the insulation, the last is the sheath.
   */
  const insulation = pick(occurrences, 'insulation', 'first');
  const sheath = pick(occurrences, 'sheath', 'last', insulation.occurrence);

  return {
    raw: text,
    cores,
    sizeMm2: size,
    quantityMetres: quantity,
    conductor: pick(occurrences, 'conductor', 'only').field,
    insulation: insulation.field,
    screen: pick(occurrences, 'screen', 'only').field,
    armour: pick(occurrences, 'armour', 'only').field,
    sheath: sheath.field,
    voltage: pick(occurrences, 'voltage', 'only').field,
    standard: pick(occurrences, 'standard', 'only').field,
    unknownTerms: findUnknownTerms(folded, occurrences),
  };
}

/**
 * Every dictionary phrase present, longest-first so "steel wire armoured" wins
 * over "steel", and non-overlapping so one span is read once.
 */
function findOccurrences(
  folded: string,
  dictionary: Dictionary,
): readonly Occurrence[] {
  const candidates: Occurrence[] = [];

  const phrases = new Set<string>();
  for (const axis of ALL_AXES) for (const p of dictionary.phrasesFor(axis)) phrases.add(p);

  for (const phrase of [...phrases].sort((a, b) => b.length - a.length)) {
    const re = new RegExp(
      `(?:^|[^a-z0-9])(${escapeRegExp(phrase)})(?:[^a-z0-9]|$)`,
      'g',
    );
    let m: RegExpExecArray | null;
    while ((m = re.exec(folded)) !== null) {
      const start = m.index + m[0].indexOf(m[1]!);
      const end = start + phrase.length;

      // A longer phrase already covering this span wins.
      if (candidates.some((c) => start >= c.start && end <= c.end)) {
        re.lastIndex = end;
        continue;
      }

      const byAxis = new Map<Axis, string>();
      for (const axis of ALL_AXES) {
        const canonical = dictionary.canonicalise(phrase, axis);
        if (canonical !== undefined) byAxis.set(axis, canonical);
      }
      if (byAxis.size > 0) candidates.push({ start, end, phrase, byAxis });

      re.lastIndex = end;
    }
  }

  return candidates.sort((a, b) => a.start - b.start);
}

interface Picked {
  readonly field: ExtractedField<string>;
  readonly occurrence: Occurrence | undefined;
}

/**
 * `only` — the axis must resolve to exactly one canonical term, or it comes
 * back empty. Two armour terms in one line is not a cable anyone can price.
 *
 * `first` / `last` — positional, for the insulation/sheath pair where the same
 * word legitimately appears twice.
 */
function pick(
  occurrences: readonly Occurrence[],
  axis: Axis,
  mode: 'only' | 'first' | 'last',
  exclude?: Occurrence | undefined,
): Picked {
  const onAxis = occurrences.filter(
    (o) => o.byAxis.has(axis) && (exclude === undefined || o !== exclude),
  );
  if (onAxis.length === 0) return { field: empty<string>(), occurrence: undefined };

  if (mode === 'only') {
    const distinct = new Set(onAxis.map((o) => o.byAxis.get(axis)!));
    if (distinct.size !== 1) return { field: empty<string>(), occurrence: undefined };
    const first = onAxis[0]!;
    return { field: found(first.byAxis.get(axis)!, first.phrase), occurrence: first };
  }

  const chosen = mode === 'first' ? onAxis[0]! : onAxis[onAxis.length - 1]!;
  return { field: found(chosen.byAxis.get(axis)!, chosen.phrase), occurrence: chosen };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Words that look like spec terms — acronyms, material names — that the
 * dictionary doesn't recognise. These pause the line so the Rate Owner can
 * teach the dictionary rather than the app inventing a meaning.
 */
const KNOWN_NOISE = new Set([
  'cable', 'wire', 'wires', 'cores', 'core', 'sq', 'mm', 'mm2', 'x', 'and',
  'to', 'off', 'lv', 'mv', 'hv', 'round', 'sector', 'shaped', 'stranded',
  'solid', 'black', 'red', 'blue', 'yellow', 'green', 'grey', 'white',
  'natural', 'class', 'cl', 'type', 'as', 'per', 'with', 'for', 'the', 'of',
  'or', 'no', 'pair', 'pairs', 'pr', 'c', 'v', 'kv', 'm', 'km', 'qty',
  'quantity', 'each', 'ea', 'nos', 'item', 'supply', 'delivery',
  // Construction words that describe a cable without identifying one. They
  // belong to no matching axis, so flagging them would pause every line.
  'bedding', 'filler', 'fillers', 'binder', 'tape', 'sheathed', 'insulated',
  'armoured', 'armored', 'screened', 'unarmoured', 'unarmored', 'multicore',
  'single', 'conductor', 'conductors', 'annealed', 'plain', 'compound',
]);

function findUnknownTerms(
  folded: string,
  occurrences: readonly Occurrence[],
): readonly string[] {
  const known = new Set<string>();
  for (const o of occurrences) for (const w of o.phrase.split(' ')) known.add(w);

  const out: string[] = [];
  for (const word of folded.split(/[^a-z0-9/]+/)) {
    if (word.length < 2 || word.length > 24) continue;
    if (/^\d/.test(word)) continue;
    if (known.has(word) || KNOWN_NOISE.has(word)) continue;
    if (!out.includes(word)) out.push(word);
  }
  return out;
}
