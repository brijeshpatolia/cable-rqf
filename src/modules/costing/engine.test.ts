import { describe, expect, it } from 'vitest';
import { dec } from '@/core/decimal';
import {
  hours,
  kgPerKm,
  omrPerHour,
  omrPerKg,
  omrPerKm,
  omrPerUSD,
  metres,
  percent,
  usdPerTonne,
} from '@/core/units';
import { computeCost } from './engine';
import { copperRatePerKg } from './copper';
import type {
  CommercialTerms,
  Product,
  ResolvedRateSet,
} from './types';

const AS_OF = new Date('2026-07-24T10:20:00Z');

const source = (id: string, table: string) => ({
  rateId: id,
  effectiveFrom: AS_OF,
  table,
});

const product: Product = {
  id: 'p1',
  designation: '4C x 50mm² Cu XLPE SWA PVC 0.6/1kV',
  cores: 4,
  sizeMm2: dec(50),
  family: 'LV Power',
  bom: [
    {
      materialKey: 'CU_CONDUCTOR',
      materialName: 'Copper conductor',
      consumption: kgPerKm(684),
      scrapPercent: percent(2),
    },
    {
      materialKey: 'XLPE',
      materialName: 'XLPE insulation',
      consumption: kgPerKm(142),
      scrapPercent: percent(3),
    },
  ],
  operations: [
    {
      machineKey: 'DRAW',
      machineName: 'Rod breakdown',
      sequence: 1,
      hoursPerKm: hours(2),
      scalesWithCores: false,
    },
    {
      machineKey: 'INSUL',
      machineName: 'Insulation line',
      sequence: 2,
      hoursPerKm: hours(1.5),
      scalesWithCores: true,
    },
  ],
  overheads: [{ key: 'TOOL', name: 'Tooling', amount: omrPerKm(188) }],
};

const rates: ResolvedRateSet = {
  asOf: AS_OF,
  materials: new Map([
    ['XLPE', { rate: omrPerKg('1.180'), source: source('m-xlpe', 'material_rate') }],
  ]),
  machines: new Map([
    ['DRAW', { rate: omrPerHour('12.000'), source: source('mc-draw', 'machine_rate') }],
    ['INSUL', { rate: omrPerHour('18.000'), source: source('mc-ins', 'machine_rate') }],
  ]),
  copper: {
    lme: usdPerTonne('9340.00'),
    fx: omrPerUSD('0.3845'),
    drawingPremiumBySize: new Map([['50', omrPerKg('0.293')]]),
    source: source('lme-2026-07-24', 'lme_price'),
  },
};

const terms: CommercialTerms = {
  marginPercent: percent(24),
  drumCost: omrPerKm(0),
  packingCost: omrPerKm(0),
  freightCost: omrPerKm(0),
};

describe('copper driver', () => {
  it('applies LME x FX / 1000 + drawing premium', () => {
    const rate = copperRatePerKg(rates.copper, '50');
    expect(rate.ok).toBe(true);
    // 9340 × 0.3845 ÷ 1000 = 3.591230, + 0.293 = 3.884230
    if (rate.ok) expect(rate.value.toFixed(6)).toBe('3.884230');
  });

  it('refuses to price a size with no drawing premium held', () => {
    const rate = copperRatePerKg(rates.copper, '240');
    expect(rate.ok).toBe(false);
    if (!rate.ok) expect(rate.error.code).toBe('MISSING_RATE');
  });
});

describe('computeCost', () => {
  it('costs materials with scrap applied before the rate', () => {
    const result = computeCost(product, { metres: metres(12000) }, rates, terms);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const copper = result.value.materials[0]!;
    // 684 × 1.02 = 697.68 kg/km
    expect(copper.effectiveConsumption.toFixed(3)).toBe('697.680');
    // 697.68 × 3.88423 = 2,709.9495864 OMR/km
    expect(copper.cost.toFixed(6)).toBe('2709.949586');
    expect(copper.source.lmeLinked).toBe(true);
  });

  it('scales machine hours by cores only where the stage does', () => {
    const result = computeCost(product, { metres: metres(1000) }, rates, terms);
    if (!result.ok) throw new Error('expected ok');

    const [draw, insulation] = result.value.operations;
    expect(draw!.hours.toFixed(2)).toBe('2.00'); // does not scale
    expect(insulation!.hours.toFixed(2)).toBe('6.00'); // 1.5 × 4 cores
  });

  it('rolls up to cost per metre and applies margin to manufactured cost only', () => {
    const result = computeCost(product, { metres: metres(1000) }, rates, terms);
    if (!result.ok) throw new Error('expected ok');
    const b = result.value;

    expect(b.costPerKm.toFixed(3)).toBe(
      b.materialsSubtotal
        .plus(b.operationsSubtotal)
        .plus(b.overheadsSubtotal)
        .toFixed(3),
    );
    expect(b.costPerMetre.toFixed(6)).toBe(b.costPerKm.dividedBy(1000).toFixed(6));
    expect(b.commercial.marginAmount.toFixed(6)).toBe(
      b.costPerKm.times(24).dividedBy(100).toFixed(6),
    );
  });

  it('refuses to price when a material rate is missing — it does not guess', () => {
    const withoutXlpe: ResolvedRateSet = { ...rates, materials: new Map() };
    const result = computeCost(product, { metres: metres(1000) }, withoutXlpe, terms);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('MISSING_RATE');
      expect(result.error.message).toContain('XLPE insulation');
    }
  });

  it('gives every leaf a provenance reference', () => {
    const result = computeCost(product, { metres: metres(1000) }, rates, terms);
    if (!result.ok) throw new Error('expected ok');

    const leaves = [
      ...result.value.materials,
      ...result.value.operations,
      ...result.value.overheads,
    ];
    for (const leaf of leaves) {
      expect(leaf.source.rateId).toBeTruthy();
      expect(leaf.source.table).toBeTruthy();
      expect(leaf.source.effectiveFrom).toBeInstanceOf(Date);
    }
  });

  it('is deterministic — same inputs, same bytes out', () => {
    const a = computeCost(product, { metres: metres(12000) }, rates, terms);
    const b = computeCost(product, { metres: metres(12000) }, rates, terms);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('does not round intermediates — a full recost equals the sum of its parts', () => {
    const result = computeCost(product, { metres: metres(12000) }, rates, terms);
    if (!result.ok) throw new Error('expected ok');
    const b = result.value;
    expect(b.lineTotal.toFixed(6)).toBe(b.unitRate.times(12000).toFixed(6));
  });
});
