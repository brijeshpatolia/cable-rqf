import { describe, expect, it } from 'vitest';
import { dec } from '@/core/decimal';
import { kg, metres, omrPerMetre } from '@/core/units';
import {
  RAW_MATERIALS,
  SOURCE_LME,
  SOURCE_TERMS,
  products,
  rateSetAt,
} from '@/infra/data';
import { computeCost } from '@/modules/costing/engine';
import type { CostBreakdown, Product } from '@/modules/costing/types';
import { deriveBounds, validate } from './validate';

const LIBRARY = products();
const RATES = rateSetAt(new Date('2026-01-01T00:00:00Z'), SOURCE_LME);
const LME_LINKED = new Set(RAW_MATERIALS.filter((m) => m.lmeLinked).map((m) => m.code));

const cost = (p: Product) =>
  computeCost(p, { metres: metres(1000) }, RATES, SOURCE_TERMS);

const BOUNDS = deriveBounds(LIBRARY, LME_LINKED, (p) => {
  const r = cost(p);
  return r.ok ? r.value.unitRate : null;
});

describe('plausibility bounds', () => {
  it('derives a copper band from the library', () => {
    expect(BOUNDS.copperPerCoreMm2.high.greaterThan(BOUNDS.copperPerCoreMm2.low)).toBe(
      true,
    );
    expect(BOUNDS.ratePerCoreMm2ByFamily.size).toBeGreaterThan(0);
  });

  it('passes every product the library itself contains', () => {
    // The bands are derived from these cables, so none of them may be held.
    // If this fails, the gate would fire on Nuhas's own catalogue.
    for (const product of LIBRARY) {
      const result = cost(product);
      if (!result.ok) continue;
      expect(
        validate(result.value, product, BOUNDS),
        `${product.id} was held by its own bounds`,
      ).toHaveLength(0);
    }
  });

  it('rejects the spec own example — a 3-core 50mm² cable at 4,000 kg/km', () => {
    const product = LIBRARY.find(
      (p) => p.spec.cores === 3 && p.spec.sizeMm2.equals(dec(50)),
    )!;
    const result = cost(product);
    if (!result.ok) throw new Error('expected ok');

    const nonsense: CostBreakdown = {
      ...result.value,
      copperMassPerKm: kg('4000'),
    };

    const violations = validate(nonsense, product, BOUNDS);
    expect(violations.map((v) => v.code)).toContain('COPPER_MASS');
    expect(violations[0]!.message).toContain('implausible');
  });

  it('holds a price that falls outside its family band', () => {
    const product = LIBRARY[0]!;
    const result = cost(product);
    if (!result.ok) throw new Error('expected ok');

    const misplacedDecimal: CostBreakdown = {
      ...result.value,
      unitRate: omrPerMetre(result.value.unitRate.times(100)),
    };

    expect(validate(misplacedDecimal, product, BOUNDS).map((v) => v.code)).toContain(
      'PRICE_BAND',
    );
  });

  it('reports every violation, not just the first', () => {
    const product = LIBRARY[0]!;
    const result = cost(product);
    if (!result.ok) throw new Error('expected ok');

    const broken: CostBreakdown = {
      ...result.value,
      copperMassPerKm: kg('9999'),
      unitRate: omrPerMetre(result.value.unitRate.times(500)),
    };

    expect(validate(broken, product, BOUNDS).length).toBeGreaterThan(1);
  });
});
