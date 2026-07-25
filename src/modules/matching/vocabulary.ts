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
  { canonical: '6kV', axis: 'voltage', synonyms: ['6kv', '3.6/6kv', '6 kv'] },
  { canonical: '15kV', axis: 'voltage', synonyms: ['15kv', '8.7/15kv', '15 kv'] },
  { canonical: '30kV', axis: 'voltage', synonyms: ['30kv', '18/30kv', '30 kv'] },
  { canonical: '11kV', axis: 'voltage', synonyms: ['11kv', '6.35/11kv', '11 kv'] },
  { canonical: '33kV', axis: 'voltage', synonyms: ['33kv', '19/33kv', '33 kv'] },
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

export const VOCABULARY: readonly Term[] = [
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

const INDEX: ReadonlyMap<string, readonly Term[]> = (() => {
  const map = new Map<string, Term[]>();
  for (const term of VOCABULARY) {
    for (const synonym of [term.canonical, ...term.synonyms]) {
      const k = fold(synonym);
      const list = map.get(k);
      if (list === undefined) map.set(k, [term]);
      else if (!list.includes(term)) list.push(term);
    }
  }
  return map;
})();

/**
 * The canonical term for a phrase on a given axis, or `undefined`.
 *
 * Axis-scoped because the same word means different things in different
 * positions: "PVC" is an insulation and a sheath, and which one it is depends
 * on where it appeared in the line, not on the word.
 */
export function canonicalise(phrase: string, axis: Axis): string | undefined {
  const matches = INDEX.get(fold(phrase));
  return matches?.find((t) => t.axis === axis)?.canonical;
}

/** Every phrase the dictionary recognises for an axis, longest first. */
export function phrasesFor(axis: Axis): readonly string[] {
  const out: string[] = [];
  for (const term of VOCABULARY) {
    if (term.axis !== axis) continue;
    out.push(fold(term.canonical), ...term.synonyms.map(fold));
  }
  return [...new Set(out)].sort((a, b) => b.length - a.length);
}

/** An unfamiliar phrase — the job pauses on these rather than guessing. */
export interface UnknownTerm {
  readonly phrase: string;
  readonly axis: Axis;
}
