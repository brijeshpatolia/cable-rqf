import type { Decimal } from '@/core/decimal';
import type { CableSpec, Product } from '@/modules/costing/types';
import type { ExtractedLine } from './parse';

/**
 * Product matching.
 *
 * Compares extracted fields against Nuhas's costed products and sorts each
 * line into one of four tiers. **Deterministic — no model, no scoring
 * heuristic, no fuzzy threshold anywhere in the pricing path.**
 *
 * The rule the app never breaks: if it isn't confident, it doesn't price. A
 * line marked "engineer to price" costs twenty minutes. A wrong price costs
 * the margin on the whole order.
 */

export type Tier = 'exact' | 'close' | 'partial' | 'no-match';

/** The fields compared, in the order the engineer reads them. */
export const MATCH_AXES = [
  'cores',
  'sizeMm2',
  'conductor',
  'insulation',
  'screen',
  'armour',
  'sheath',
  'voltage',
  'standard',
] as const;

export type MatchAxis = (typeof MATCH_AXES)[number];

/**
 * Axes where a difference is a *core parameter* change — a different cable,
 * not a different finish. A line differing on any of these is never priced
 * automatically, however close the rest of it looks.
 */
export const CORE_PARAMETERS: ReadonlySet<MatchAxis> = new Set([
  'cores',
  'sizeMm2',
  'voltage',
]);

/**
 * A substitution the Rate Owner has declared safe.
 *
 * **Ships empty, by design.** The spec's discipline is that this list starts
 * nearly empty and grows only on the Rate Owner's explicit decision, with each
 * addition audited — a permissive allowlist is how wrong prices get out.
 *
 * Note for whoever adds the first rule: the imported library contains no two
 * products differing on exactly one non-core axis, so no substitution can be
 * inferred from the data. Each rule is a judgement about what Nuhas can safely
 * build, and needs the material mapping that lets the cost be rebuilt.
 */
export interface SubstitutionRule {
  readonly axis: MatchAxis;
  readonly from: string;
  readonly to: string;
  /** Why this substitution is safe. Shown to the engineer on every Close line. */
  readonly rationale: string;
}

export const SUBSTITUTION_RULES: readonly SubstitutionRule[] = [];

export interface AxisDifference {
  readonly axis: MatchAxis;
  readonly requested: string;
  readonly held: string;
}

export interface Candidate {
  readonly product: Product;
  readonly differences: readonly AxisDifference[];
}

export type MatchResult =
  | { readonly tier: 'exact'; readonly product: Product }
  | {
      readonly tier: 'close';
      readonly product: Product;
      readonly substitution: SubstitutionRule;
      readonly difference: AxisDifference;
    }
  | {
      readonly tier: 'partial';
      readonly reason: string;
      /** Nearest products and exactly which fields differ. Never priced. */
      readonly nearest: readonly Candidate[];
    }
  | { readonly tier: 'no-match'; readonly reason: string };

/** Fields the extractor could not resolve. A line with any of these is unpriceable. */
export function missingFields(line: ExtractedLine): readonly MatchAxis[] {
  const out: MatchAxis[] = [];
  if (line.cores.value === null) out.push('cores');
  if (line.sizeMm2.value === null) out.push('sizeMm2');
  if (line.conductor.value === null) out.push('conductor');
  if (line.insulation.value === null) out.push('insulation');
  if (line.voltage.value === null) out.push('voltage');
  // Screen, armour, sheath and standard may legitimately be absent — an
  // unarmoured cable has no armour term — so they are not required here.
  return out;
}

function specOf(line: ExtractedLine): Partial<CableSpec> {
  return {
    ...(line.cores.value !== null ? { cores: line.cores.value } : {}),
    ...(line.sizeMm2.value !== null ? { sizeMm2: line.sizeMm2.value } : {}),
    ...(line.conductor.value !== null ? { conductor: line.conductor.value } : {}),
    ...(line.insulation.value !== null ? { insulation: line.insulation.value } : {}),
    screen: line.screen.value ?? '',
    armour: line.armour.value ?? '',
    sheath: line.sheath.value ?? '',
    ...(line.voltage.value !== null ? { voltage: line.voltage.value } : {}),
    standard: line.standard.value ?? '',
  };
}

function valueOf(spec: Partial<CableSpec>, axis: MatchAxis): string {
  const v = spec[axis];
  if (v === undefined || v === null) return '';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return v;
  return (v as Decimal).toString();
}

/**
 * Axes actually compared for a line. Standard is only compared when the
 * customer stated one — a customer who omits the standard is not asking for a
 * different cable, and holding that against every product would make every
 * line Partial.
 */
function comparedAxes(requested: Partial<CableSpec>): readonly MatchAxis[] {
  return MATCH_AXES.filter(
    (a) => !(a === 'standard' && valueOf(requested, 'standard') === ''),
  );
}

function differencesAgainst(
  requested: Partial<CableSpec>,
  product: Product,
): readonly AxisDifference[] {
  const out: AxisDifference[] = [];
  for (const axis of comparedAxes(requested)) {
    const want = valueOf(requested, axis);
    const held = valueOf(product.spec, axis);
    // Sizes compare numerically: "50" and "50.0" are the same cable.
    const same =
      axis === 'sizeMm2'
        ? Number(want) === Number(held)
        : want.toLowerCase() === held.toLowerCase();
    if (!same) out.push({ axis, requested: want, held });
  }
  return out;
}

export interface MatchOptions {
  readonly substitutions?: readonly SubstitutionRule[];
  /** How many nearest products a Partial line shows. */
  readonly nearestCount?: number;
}

export function matchLine(
  line: ExtractedLine,
  products: readonly Product[],
  options: MatchOptions = {},
): MatchResult {
  const { substitutions = SUBSTITUTION_RULES, nearestCount = 3 } = options;

  // ── Unresolved wording pauses the line before anything is compared ────
  if (line.unknownTerms.length > 0) {
    return {
      tier: 'partial',
      reason: `Unfamiliar wording: ${line.unknownTerms.join(', ')}. Add it to the dictionary and this line will resolve.`,
      nearest: [],
    };
  }

  const missing = missingFields(line);
  if (missing.length > 0) {
    return {
      tier: 'partial',
      reason: `Could not read ${missing.map(axisLabel).join(', ')} from this line.`,
      nearest: [],
    };
  }

  const requested = specOf(line);

  // ── Outside the library entirely ──────────────────────────────────────
  if (requested.conductor !== 'Cu') {
    return {
      tier: 'no-match',
      reason: `${requested.conductor} conductor — the library is copper only.`,
    };
  }

  const heldVoltages = new Set(products.map((p) => p.spec.voltage));
  if (!heldVoltages.has(requested.voltage ?? '')) {
    return {
      tier: 'no-match',
      reason: `${requested.voltage} is not a voltage the library holds a costed product for.`,
    };
  }

  const scored = products
    .map((product) => ({ product, differences: differencesAgainst(requested, product) }))
    .sort((a, b) => a.differences.length - b.differences.length);

  // ── Exact ─────────────────────────────────────────────────────────────
  const exact = scored.find((c) => c.differences.length === 0);
  if (exact !== undefined) return { tier: 'exact', product: exact.product };

  // ── Close: exactly one difference, on a declared-safe axis ────────────
  for (const candidate of scored) {
    if (candidate.differences.length !== 1) continue;
    const difference = candidate.differences[0]!;
    if (CORE_PARAMETERS.has(difference.axis)) continue;

    const rule = substitutions.find(
      (s) =>
        s.axis === difference.axis &&
        s.from === difference.held &&
        s.to === difference.requested,
    );
    if (rule === undefined) continue;

    return { tier: 'close', product: candidate.product, substitution: rule, difference };
  }

  // ── Partial: nearest products, stated differences, no price ──────────
  const nearest = scored.slice(0, nearestCount);
  const closest = nearest[0];

  const reason =
    closest === undefined
      ? 'No costed product to compare against.'
      : closest.differences.length === 1
        ? `Differs from the nearest costed product on ${axisLabel(closest.differences[0]!.axis)}: ` +
          `asked for ${closest.differences[0]!.requested || '(none)'}, ` +
          `library holds ${closest.differences[0]!.held || '(none)'}.`
        : `Differs from the nearest costed product on ${closest.differences.length} fields: ` +
          `${closest.differences.map((d) => axisLabel(d.axis)).join(', ')}.`;

  return { tier: 'partial', reason, nearest };
}

/** Whether a tier may carry a price at all. Partial and No-match never can. */
export function isPriceable(
  result: MatchResult,
): result is Extract<MatchResult, { tier: 'exact' | 'close' }> {
  return result.tier === 'exact' || result.tier === 'close';
}

export function axisLabel(axis: MatchAxis): string {
  switch (axis) {
    case 'cores':
      return 'cores';
    case 'sizeMm2':
      return 'size';
    case 'conductor':
      return 'conductor';
    case 'insulation':
      return 'insulation';
    case 'screen':
      return 'screen';
    case 'armour':
      return 'armour';
    case 'sheath':
      return 'sheath';
    case 'voltage':
      return 'voltage';
    case 'standard':
      return 'standard';
  }
}
