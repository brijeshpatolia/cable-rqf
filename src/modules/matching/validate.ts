import { type Decimal, dec, ZERO } from '@/core/decimal';
import type { CostBreakdown, Product } from '@/modules/costing';

/**
 * The plausibility gate.
 *
 * Nothing reaches the engineer as a price until it has passed here. A nonsense
 * value is rejected by validation — a 3-core 50mm² cable cannot weigh
 * 4,000 kg/km — and a price outside the expected band is held for review
 * before it can be approved.
 *
 * The bounds are **derived from the imported library**, not invented. Ninety-
 * nine real costed cables describe what a plausible cable looks like far
 * better than a constant anyone would pick by hand, and the bounds widen on
 * their own as the library grows.
 */

export type CheckCode = 'COPPER_MASS' | 'PRICE_BAND';

export interface Violation {
  readonly code: CheckCode;
  /** Stated as a fact, with the observed value and the band it fell outside. */
  readonly message: string;
}

export interface Bounds {
  /** kg of copper per km, per (core × mm²). */
  readonly copperPerCoreMm2: Range;
  /** OMR per metre, per (core × mm²), by family. */
  readonly ratePerCoreMm2ByFamily: ReadonlyMap<string, Range>;
}

export interface Range {
  readonly low: Decimal;
  readonly high: Decimal;
}

/**
 * How far outside the observed range a value may sit before it is held.
 *
 * Wide on purpose. This gate exists to catch nonsense — a misplaced decimal, a
 * transposed field — not to second-guess an engineer costing an unusual cable.
 * A tight band would fire constantly and be ignored, which is worse than no
 * gate at all.
 */
const TOLERANCE = dec('0.5');

function widen(range: Range): Range {
  const span = range.high.minus(range.low);
  const pad = span.times(TOLERANCE);
  return { low: range.low.minus(pad), high: range.high.plus(pad) };
}

function rangeOf(values: readonly Decimal[]): Range | undefined {
  if (values.length === 0) return undefined;
  let low = values[0]!;
  let high = values[0]!;
  for (const v of values) {
    if (v.lessThan(low)) low = v;
    if (v.greaterThan(high)) high = v;
  }
  return { low, high };
}

/** Copper mass in a product's bill of materials, before rates are applied. */
function copperMass(product: Product, lmeLinked: ReadonlySet<string>): Decimal {
  return product.bom
    .filter((b) => lmeLinked.has(b.materialKey))
    .reduce<Decimal>((acc, b) => acc.plus(b.consumption).plus(b.scrap), ZERO);
}

function coreMm2(product: Product): Decimal {
  return dec(product.spec.cores).times(product.spec.sizeMm2);
}

/**
 * Derives the bands from the library. Called once and reused — it is a pure
 * function of the product set, so it can be cached alongside it.
 */
export function deriveBounds(
  products: readonly Product[],
  lmeLinkedMaterials: ReadonlySet<string>,
  ratePerMetre: (product: Product) => Decimal | null,
): Bounds {
  const copperRatios: Decimal[] = [];
  const byFamily = new Map<string, Decimal[]>();

  for (const product of products) {
    const denominator = coreMm2(product);
    if (denominator.isZero()) continue;

    const mass = copperMass(product, lmeLinkedMaterials);
    if (mass.greaterThan(0)) copperRatios.push(mass.dividedBy(denominator));

    const rate = ratePerMetre(product);
    if (rate !== null && rate.greaterThan(0)) {
      const list = byFamily.get(product.family);
      const ratio = rate.dividedBy(denominator);
      if (list === undefined) byFamily.set(product.family, [ratio]);
      else list.push(ratio);
    }
  }

  const rateRanges = new Map<string, Range>();
  for (const [family, ratios] of byFamily) {
    const r = rangeOf(ratios);
    if (r !== undefined) rateRanges.set(family, widen(r));
  }

  return {
    copperPerCoreMm2: widen(rangeOf(copperRatios) ?? { low: ZERO, high: ZERO }),
    ratePerCoreMm2ByFamily: rateRanges,
  };
}

/**
 * Checks a costed line against the bands.
 *
 * Returns every violation rather than the first, because an engineer looking
 * at a held line wants the whole picture, not one symptom at a time.
 */
export function validate(
  breakdown: CostBreakdown,
  product: Product,
  bounds: Bounds,
): readonly Violation[] {
  const out: Violation[] = [];
  const denominator = coreMm2(product);
  if (denominator.isZero()) return out;

  const copperRatio = breakdown.copperMassPerKm.dividedBy(denominator);
  const copperBand = bounds.copperPerCoreMm2;
  if (
    breakdown.copperMassPerKm.greaterThan(0) &&
    (copperRatio.lessThan(copperBand.low) || copperRatio.greaterThan(copperBand.high))
  ) {
    out.push({
      code: 'COPPER_MASS',
      message:
        `Copper mass of ${breakdown.copperMassPerKm.toFixed(1)} kg/km is implausible for ` +
        `${product.spec.cores} cores × ${product.spec.sizeMm2.toString()} mm². ` +
        `Costed cables run ${copperBand.low.toFixed(2)}–${copperBand.high.toFixed(2)} kg per core-mm².`,
    });
  }

  const rateBand = bounds.ratePerCoreMm2ByFamily.get(product.family);
  if (rateBand !== undefined) {
    const rateRatio = breakdown.unitRate.dividedBy(denominator);
    if (rateRatio.lessThan(rateBand.low) || rateRatio.greaterThan(rateBand.high)) {
      out.push({
        code: 'PRICE_BAND',
        message:
          `Unit rate of ${breakdown.unitRate.toFixed(3)} OMR/m falls outside the band for ` +
          `${product.family}. Held for review before it can be approved.`,
      });
    }
  }

  return out;
}
