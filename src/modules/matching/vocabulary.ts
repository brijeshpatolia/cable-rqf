/**
 * Vocabulary normalisation.
 *
 * Maps whatever the customer wrote to Nuhas's own terms. A fixed dictionary
 * the rate owner can edit — "steel wire armoured", "SWA", "S.W.A." all become
 * SWA.
 *
 * The canonical terms are exactly those present in the imported library, so
 * normalisation can never produce a term the catalogue doesn't use. When an
 * unfamiliar term appears the job pauses and asks; it is never guessed.
 */

export type Axis =
  | 'conductor'
  | 'insulation'
  | 'screen'
  | 'armour'
  | 'sheath'
  | 'voltage'
  | 'standard';

export interface Term {
  /** Nuhas's own term, as held in the product library. */
  readonly canonical: string;
  readonly axis: Axis;
  /** Everything a customer has been seen to write for it. */
  readonly synonyms: readonly string[];
}

/**
 * Conductor is its own axis and carries non-library terms deliberately:
 * aluminium must normalise successfully so the matcher can reject it with a
 * stated reason, rather than failing as "unknown wording".
 */
const CONDUCTOR: readonly Term[] = [
  {
    canonical: 'Cu',
    axis: 'conductor',
    synonyms: ['cu', 'copper', 'copper conductor', 'annealed copper', 'e-cu'],
  },
  {
    canonical: 'Al',
    axis: 'conductor',
    synonyms: ['al', 'aluminium', 'aluminum', 'alu', 'aluminium conductor'],
  },
];

const INSULATION: readonly Term[] = [
  {
    canonical: 'XLPE',
    axis: 'insulation',
    synonyms: ['xlpe', 'x.l.p.e', 'cross linked polyethylene', 'cross-linked pe', 'xple'],
  },
  {
    canonical: 'PVC',
    axis: 'insulation',
    synonyms: ['pvc', 'p.v.c', 'polyvinyl chloride'],
  },
];

const SCREEN: readonly Term[] = [
  {
    canonical: 'CTS',
    axis: 'screen',
    synonyms: ['cts', 'copper tape screen', 'cu tape screen', 'copper tape'],
  },
  {
    canonical: 'OSCR',
    axis: 'screen',
    synonyms: ['oscr', 'overall screen', 'overall screened', 'os'],
  },
  {
    canonical: 'IOSCR',
    axis: 'screen',
    synonyms: [
      'ioscr',
      'individual and overall screen',
      'individual & overall screen',
      'is/os',
      'isos',
    ],
  },
];

const ARMOUR: readonly Term[] = [
  {
    canonical: 'SWA',
    axis: 'armour',
    synonyms: [
      'swa',
      's.w.a',
      'steel wire armoured',
      'steel wire armour',
      'steel wire armored',
      'galvanised steel wire armour',
      'gswa',
    ],
  },
  {
    canonical: 'AWA',
    axis: 'armour',
    synonyms: [
      'awa',
      'a.w.a',
      'aluminium wire armoured',
      'aluminium wire armour',
      'aluminum wire armored',
    ],
  },
  {
    canonical: 'STA',
    axis: 'armour',
    synonyms: ['sta', 'steel tape armoured', 'steel tape armour'],
  },
];

const SHEATH: readonly Term[] = [
  { canonical: 'PVC', axis: 'sheath', synonyms: ['pvc', 'p.v.c', 'pvc sheath', 'st2'] },
  {
    canonical: 'LSOH',
    axis: 'sheath',
    synonyms: [
      'lsoh',
      'lszh',
      'ls0h',
      'low smoke zero halogen',
      'low smoke halogen free',
      'hffr',
      'lsf',
    ],
  },
  {
    canonical: 'FRRT PVC',
    axis: 'sheath',
    synonyms: [
      'frrt pvc',
      'frrt',
      'flame retardant pvc',
      'fire retardant pvc',
      'fr pvc',
    ],
  },
];

const VOLTAGE: readonly Term[] = [
  { canonical: '450/750V', axis: 'voltage', synonyms: ['450/750v', '450/750', '0.45/0.75kv'] },
  { canonical: '500V', axis: 'voltage', synonyms: ['500v', '500 v'] },
  {
    canonical: '1kV',
    axis: 'voltage',
    synonyms: ['1kv', '0.6/1kv', '600/1000v', '0.6/1 kv', '1000v', '1 kv'],
  },
  /*
    The bracketed form is how MV cable is actually specified.

    IEC writes a grade as U0/U(Um) — `3.6/6(7.2)kV` — and every MTO that came
    out of an engineering house in the region writes it that way. Without these
    the app read a whole medium-voltage schedule and could not say what voltage
    any of it was, which on MV is most of the price. Both spacings are listed
    because the bracket is set with a space as often as without.
  */
  {
    canonical: '6kV',
    axis: 'voltage',
    synonyms: ['6kv', '3.6/6kv', '6 kv', '3.6/6(7.2)kv', '3.6/6 (7.2)kv'],
  },
  {
    canonical: '15kV',
    axis: 'voltage',
    synonyms: ['15kv', '8.7/15kv', '15 kv', '8.7/15(17.5)kv', '8.7/15 (17.5)kv'],
  },
  {
    canonical: '30kV',
    axis: 'voltage',
    synonyms: ['30kv', '18/30kv', '30 kv', '18/30(36)kv', '18/30 (36)kv'],
  },
  {
    canonical: '11kV',
    axis: 'voltage',
    synonyms: ['11kv', '6.35/11kv', '11 kv', '6.35/11(12)kv', '6.35/11 (12)kv'],
  },
  {
    canonical: '33kV',
    axis: 'voltage',
    synonyms: ['33kv', '19/33kv', '33 kv', '19/33(36)kv', '19/33 (36)kv'],
  },
];

const STANDARD: readonly Term[] = [
  {
    canonical: 'IEC 60502-1',
    axis: 'standard',
    synonyms: ['iec 60502-1', 'iec60502-1', 'iec 60502 1', 'iec 60502-1:2004'],
  },
  {
    canonical: 'IEC 60502-2',
    axis: 'standard',
    synonyms: ['iec 60502-2', 'iec60502-2', 'iec 60502 2'],
  },
  {
    canonical: 'BS EN 50525-2-31',
    axis: 'standard',
    synonyms: ['bs en 50525-2-31', 'bs 50525-2-31', 'en 50525-2-31'],
  },
  {
    canonical: 'BS EN 50288-7',
    axis: 'standard',
    synonyms: ['bs en 50288-7', 'bs 50288-7', 'en 50288-7'],
  },
  {
    canonical: 'BS 5308',
    axis: 'standard',
    synonyms: ['bs 5308', 'bs5308', 'bs 5308-1', 'bs 5308-2'],
  },
];

/**
 * The terms that ship with the app.
 *
 * These are exactly the canonical values present in the imported library plus
 * the wordings already seen for them. Everything learned after go-live is
 * stored, not compiled — see `buildDictionary`.
 */
export const BUILT_IN_TERMS: readonly Term[] = [
  ...CONDUCTOR,
  ...INSULATION,
  ...SCREEN,
  ...ARMOUR,
  ...SHEATH,
  ...VOLTAGE,
  ...STANDARD,
];

/** Lower-cased, punctuation-stripped, whitespace-collapsed. */
export function fold(text: string): string {
  return text
    .toLowerCase()
    .replace(/[.’']/g, '')
    .replace(/[_\-–—]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A dictionary the parser can consult.
 *
 * Built rather than imported, because the vocabulary has to grow: the spec's
 * promise is that the app "stops asking after the first months", and it cannot
 * keep that promise from a constant compiled into the bundle. A dictionary is
 * the built-in terms plus everything the Rate Owner has taught it since, with
 * the index computed once per build rather than once per line.
 */
export interface Dictionary {
  readonly terms: readonly Term[];
  /**
   * The canonical term for a phrase on a given axis, or `undefined`.
   *
   * Axis-scoped because the same word means different things in different
   * positions: "PVC" is an insulation and a sheath, and which one it is
   * depends on where it appeared in the line, not on the word.
   */
  canonicalise(phrase: string, axis: Axis): string | undefined;
  /** Every phrase recognised for an axis, longest first. */
  phrasesFor(axis: Axis): readonly string[];
}

export function buildDictionary(terms: readonly Term[]): Dictionary {
  const index = new Map<string, Term[]>();
  for (const term of terms) {
    for (const synonym of [term.canonical, ...term.synonyms]) {
      const k = fold(synonym);
      const list = index.get(k);
      if (list === undefined) index.set(k, [term]);
      else if (!list.includes(term)) list.push(term);
    }
  }

  const phrases = new Map<Axis, readonly string[]>();
  const phrasesFor = (axis: Axis): readonly string[] => {
    const cached = phrases.get(axis);
    if (cached !== undefined) return cached;
    const out = [
      ...new Set(
        terms
          .filter((t) => t.axis === axis)
          .flatMap((t) => [fold(t.canonical), ...t.synonyms.map(fold)]),
      ),
    ].sort((a, b) => b.length - a.length);
    phrases.set(axis, out);
    return out;
  };

  return {
    terms,
    canonicalise: (phrase, axis) =>
      index.get(fold(phrase))?.find((t) => t.axis === axis)?.canonical,
    phrasesFor,
  };
}

/**
 * Merges learned terms onto the built-ins.
 *
 * A learned synonym for an existing canonical joins that term rather than
 * creating a second entry — otherwise the same cable would have two
 * dictionary rows and the Rate Owner would have to maintain both.
 */
export function mergeTerms(
  base: readonly Term[],
  learned: readonly Term[],
): readonly Term[] {
  const out = base.map((t) => ({ ...t, synonyms: [...t.synonyms] }));
  for (const term of learned) {
    const existing = out.find(
      (t) => t.axis === term.axis && fold(t.canonical) === fold(term.canonical),
    );
    if (existing === undefined) {
      out.push({ ...term, synonyms: [...term.synonyms] });
      continue;
    }
    for (const s of term.synonyms) {
      if (!existing.synonyms.some((e) => fold(e) === fold(s))) {
        existing.synonyms.push(s);
      }
    }
  }
  return out;
}

/** The dictionary with nothing learned yet. Tests and the parser default to it. */
export const BUILT_IN_DICTIONARY: Dictionary = buildDictionary(BUILT_IN_TERMS);

export function canonicalise(phrase: string, axis: Axis): string | undefined {
  return BUILT_IN_DICTIONARY.canonicalise(phrase, axis);
}

export function phrasesFor(axis: Axis): readonly string[] {
  return BUILT_IN_DICTIONARY.phrasesFor(axis);
}

/** An unfamiliar phrase — the job pauses on these rather than guessing. */
export interface UnknownTerm {
  readonly phrase: string;
  readonly axis: Axis;
}
