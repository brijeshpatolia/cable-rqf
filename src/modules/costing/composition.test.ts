import { describe, expect, it } from 'vitest';
import { ZERO, type Decimal } from '@/core/decimal';
import { metres } from '@/core/units';
import { SOURCE_LME, SOURCE_TERMS, products, rateSetAt } from '@/infra/data';
import { computeCost } from './engine';
import { compositionOf } from './composition';

/**
 * The bar has to be a proportion of a number that is on the screen.
 *
 * It was not. `costPerKm` is materials + operations + overheads + **tooling**
 * (`engine.ts:154-159`), and the bar summed only the first three before adding
 * a Commercial segment derived from `costPerKm` — so the segments reconciled
 * to neither `costPerKm` nor `unitRate × 1000`, and every percentage was
 * distorted by whatever tooling the product carried. The segment label already
 * read "Overheads & tooling"; only the arithmetic disagreed.
 *
 * Asserted over the whole library rather than one product, because tooling
 * varies per product and a single fixture could easily be one whose tooling is
 * zero — which is exactly the case that hides this defect.
 */

const AT = new Date('2026-01-01T00:00:00Z');
const RATES = rateSetAt(AT, SOURCE_LME);
const LIBRARY = products();

const sum = (ds: readonly Decimal[]): Decimal =>
  ds.reduce<Decimal>((acc, d) => acc.plus(d), ZERO);

describe('the cost composition bar', () => {
  it('reconciles to the unit rate on every product in the library', () => {
    let checked = 0;

    for (const product of LIBRARY) {
      const result = computeCost(product, { metres: metres(1000) }, RATES, SOURCE_TERMS);
      if (!result.ok) continue;

      const total = sum(compositionOf(result.value).map((s) => s.value));
      const ratePerKm = result.value.unitRate.times(1000);

      expect(
        total.minus(ratePerKm).abs().lessThan('0.000001'),
        `${product.id}: segments ${total.toString()} vs rate/km ${ratePerKm.toString()}`,
      ).toBe(true);
      checked += 1;
    }

    // A loop that costed nothing would pass every assertion above.
    expect(checked).toBe(LIBRARY.length);
  });

  it('counts tooling, which is a component of cost per km and was dropped', () => {
    // A product whose tooling is non-zero — on one whose tooling is zero the
    // old arithmetic and the new agree, and the test proves nothing.
    const product = LIBRARY.find((p) => p.toolingPerKm.greaterThan(ZERO));
    expect(product, 'no product in the library carries tooling').toBeDefined();
    if (product === undefined) return;

    const result = computeCost(product, { metres: metres(1000) }, RATES, SOURCE_TERMS);
    if (!result.ok) throw new Error(result.error.message);

    const overheads = compositionOf(result.value).find(
      (s) => s.label === 'Overheads & tooling',
    );
    expect(overheads?.value.toString()).toBe(
      result.value.overheadsSubtotal.plus(result.value.tooling).toString(),
    );
    // And it is genuinely more than overheads alone, so the fold is observable.
    expect(overheads?.value.greaterThan(result.value.overheadsSubtotal)).toBe(true);
  });

  it('has no negative segment at the terms the app actually prices on', () => {
    for (const product of LIBRARY.slice(0, 12)) {
      const result = computeCost(product, { metres: metres(1000) }, RATES, SOURCE_TERMS);
      if (!result.ok) continue;
      for (const s of compositionOf(result.value)) {
        expect(s.value.greaterThanOrEqualTo(ZERO), `${product.id} ${s.label}`).toBe(true);
      }
    }
  });

  it('keeps the identity below cost, where it used to floor and stop holding', () => {
    /*
      The branch that broke the contract. Commercial used to be floored at
      zero, on the reasoning that a share cannot be negative — but the floor
      made the parts sum to `costPerKm` rather than to `unitRate × 1000`, so
      the function silently stopped satisfying the one identity it documents
      and the bar's percentages changed denominator without changing label.

      Reached by pricing a real product under its own cost rather than by
      hand-building a breakdown, so the rest of the figures stay consistent
      with each other.
    */
    const product = LIBRARY[0];
    expect(product).toBeDefined();
    if (product === undefined) return;

    const result = computeCost(product, { metres: metres(1000) }, RATES, SOURCE_TERMS);
    if (!result.ok) throw new Error(result.error.message);

    // Half of cost: below cost by any measure, whatever the pass-throughs.
    const belowCost = {
      ...result.value,
      unitRate: result.value.costPerKm.dividedBy(2000) as typeof result.value.unitRate,
    };

    const parts = compositionOf(belowCost);
    const commercial = parts.find((p) => p.key === 'commercial');

    expect(commercial?.value.lessThan(ZERO), 'the case is not actually below cost').toBe(
      true,
    );

    const total = sum(parts.map((p) => p.value));
    const ratePerKm = belowCost.unitRate.times(1000);
    expect(
      total.minus(ratePerKm).abs().lessThan('0.000001'),
      `segments ${total.toString()} vs rate/km ${ratePerKm.toString()}`,
    ).toBe(true);
  });
});
