import type { Decimal } from '@/core/decimal';
import type { CableSpec, Product } from '@/modules/costing';
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
  /**
   * True when the candidate is the same conductor size and core count as the
   * enquiry. These are the ones an engineer can realistically pick: the copper
   * is the same, so what differs is a finish or a designation rather than a
   * different cable.
   */
  readonly sameBuild: boolean;
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
  | {
      readonly tier: 'no-match';
      readonly reason: string;
      /**
       * Offered even here.
       *
       * A No-match line used to end the conversation, which left an engineer
       * with a red row and nothing to do about it. The library may still hold
       * the same core count and size — the same copper — under a different
       * designation, and that is exactly what an engineer needs to see before
       * deciding. The tier still says the app will not price it.
       */
      readonly nearest: readonly Candidate[];
    };

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
  /**
   * How many products to offer beyond those at the same cores × size.
   *
   * Everything at the same build is offered in full regardless of this number.
   * That is the point of the list: an engineer who knows the size is right
   * wants to see every item code that carries it, not a top-three chosen by a
   * scoring rule they cannot see.
   */
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
  const scored = candidatesFor(requested, products, nearestCount);
  const sameBuild = scored.filter((c) => c.sameBuild);

  // ── Outside the library entirely ──────────────────────────────────────
  //
  // Still carrying candidates. A different conductor is genuinely a different
  // cable with a different cost basis, so the app will not price it — but the
  // engineer may well decide to quote the copper equivalent, and refusing to
  // even show it leaves them with a red row and nowhere to go.
  if (requested.conductor !== 'Cu') {
    return {
      tier: 'no-match',
      reason:
        `${requested.conductor} conductor — the library is copper only.` +
        (sameBuild.length === 0
          ? ''
          : ` The same build in copper is held under ${sameBuild.length} item ` +
            `code${sameBuild.length === 1 ? '' : 's'}, priced on copper.`),
      nearest: scored,
    };
  }

  const heldVoltages = new Set(products.map((p) => p.spec.voltage));
  if (!heldVoltages.has(requested.voltage ?? '')) {
    // A voltage the library does not hold is not automatically a cable it
    // cannot build. 33 kV is a line voltage for what Nuhas costs as a 30 kV
    // cable, and the copper is identical — so when the same core count and
    // size *is* held, this is a line an engineer can settle, not a dead end.
    if (sameBuild.length > 0) {
      return {
        tier: 'partial',
        reason:
          `${requested.voltage} is not a voltage the library holds a costed ` +
          `product for, but ${sameBuild.length} item ` +
          `code${sameBuild.length === 1 ? '' : 's'} carry this core count and ` +
          'size. Voltage designations differ between standards — pick the ' +
          'right one, or price it by hand.',
        nearest: scored,
      };
    }

    return {
      tier: 'no-match',
      reason:
        `${requested.voltage} is not a voltage the library holds a costed ` +
        'product for, and nothing is held at this core count and size either.',
      nearest: scored,
    };
  }

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

  // ── Partial: candidates, stated differences, no price ────────────────
  return { tier: 'partial', reason: reasonFor(scored), nearest: scored };
}

/**
 * The products worth offering, best first.
 *
 * **Everything at the same cores × size comes first, and all of it is
 * offered.** That is the finding this function exists to serve: an engineer
 * looking at a 33 kV enquiry knows the copper is a 3-core 50 mm², and wants to
 * see every item code carrying that build so they can pick the right one. A
 * top-three ranked by "fewest differing fields" would have shown them cables
 * of the wrong size that happened to agree on more of the finish — which is
 * both useless and, if picked, wrong.
 *
 * Products at a different build follow, capped, because they are a fallback
 * rather than an answer.
 */
export function candidatesFor(
  requested: Partial<CableSpec>,
  products: readonly Product[],
  otherBuildCount = 3,
): readonly Candidate[] {
  const scored = products.map((product) => ({
    product,
    differences: differencesAgainst(requested, product),
    sameBuild: isSameBuild(requested, product),
  }));

  // Same build: everything else is equal, so fewest differences wins.
  const byDifferences = (a: Candidate, b: Candidate) =>
    a.differences.length - b.differences.length ||
    a.product.id.localeCompare(b.product.id);

  /**
   * Different build: nearest *cable* wins, not fewest differing fields.
   *
   * Ranking these by field count offered a 2.5 mm² cable to a 55 mm² enquiry
   * because it happened to agree on the finish — which is worse than useless,
   * since picking it would quote the wrong copper. Core count is compared
   * before size, because 3-core to 4-core is a bigger jump than 50 mm² to
   * 70 mm², and size is compared in proportion so 50→70 beats 300→500.
   */
  const cores = Number(valueOf(requested, 'cores'));
  const size = Number(valueOf(requested, 'sizeMm2'));

  const byNearestCable = (a: Candidate, b: Candidate) =>
    coreDistance(a, cores) - coreDistance(b, cores) ||
    sizeDistance(a, size) - sizeDistance(b, size) ||
    byDifferences(a, b);

  const sameBuild = scored.filter((c) => c.sameBuild).sort(byDifferences);
  const rest = scored
    .filter((c) => !c.sameBuild)
    .sort(byNearestCable)
    .slice(0, otherBuildCount);

  return [...sameBuild, ...rest];
}

function coreDistance(c: Candidate, cores: number): number {
  const held = Number(valueOf(c.product.spec, 'cores'));
  return Number.isFinite(cores) && Number.isFinite(held) ? Math.abs(held - cores) : 0;
}

/** Proportional, so 50→70 ranks ahead of 300→500 despite the smaller ratio. */
function sizeDistance(c: Candidate, size: number): number {
  const held = Number(valueOf(c.product.spec, 'sizeMm2'));
  if (!Number.isFinite(size) || !Number.isFinite(held) || size <= 0 || held <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.abs(Math.log(held / size));
}

/** Same core count and same conductor size — the copper is the same. */
function isSameBuild(requested: Partial<CableSpec>, product: Product): boolean {
  const cores = valueOf(requested, 'cores');
  const size = valueOf(requested, 'sizeMm2');
  if (cores === '' || size === '') return false;
  return (
    Number(cores) === Number(valueOf(product.spec, 'cores')) &&
    Number(size) === Number(valueOf(product.spec, 'sizeMm2'))
  );
}

function reasonFor(candidates: readonly Candidate[]): string {
  const sameBuild = candidates.filter((c) => c.sameBuild).length;
  if (sameBuild > 0) {
    return (
      `Not an exact match, but the library holds ${sameBuild} item ` +
      `code${sameBuild === 1 ? '' : 's'} at this core count and size. ` +
      'Pick the right one, or price it by hand.'
    );
  }

  const closest = candidates[0];
  if (closest === undefined) return 'No costed product to compare against.';

  return closest.differences.length === 1
    ? `Differs from the nearest costed product on ${axisLabel(closest.differences[0]!.axis)}: ` +
      `asked for ${closest.differences[0]!.requested || '(none)'}, ` +
      `library holds ${closest.differences[0]!.held || '(none)'}.`
    : `Differs from the nearest costed product on ${closest.differences.length} fields: ` +
      `${closest.differences.map((d) => axisLabel(d.axis)).join(', ')}.`;
}

/**
 * How a product differs from what the line asked for.
 *
 * Exported so the review screen can name the differences on a line an engineer
 * chose a product for — the whole value of a chosen line is that the app still
 * says out loud what was swapped, rather than quietly pricing something else.
 */
export function differencesBetween(
  line: ExtractedLine,
  product: Product,
): readonly AxisDifference[] {
  return differencesAgainst(specOf(line), product);
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
