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
import { copperMetalValue, effectiveMaterialRate } from './copper';
import type { CommercialTerms, Product, ResolvedRateSet } from './types';

const AS_OF = new Date('2026-07-24T10:20:00Z');

const source = (id: string, table: string) => ({
  rateId: id,
  effectiveFrom: AS_OF,
  table,
});

const product: Product = {
  id: 'TEST-1',
  designation: '4C × 50mm² Cu XLPE SWA PVC 0.6/1kV',
  family: 'LV Power',
  spec: {
    cores: 4,
    sizeMm2: dec(50),
    conductor: 'Cu',
    insulation: 'XLPE',
    screen: '',
    armour: 'SWA',
    sheath: 'PVC',
    voltage: '1kV',
    standard: 'IEC 60502-1',
  },
  toolingPerKm: omrPerKm('0.033'),
  bom: [
    {
      materialKey: 'CU50',
      materialName: 'Copper conductor 50mm²',
      consumption: kgPerKm('684'),
      scrap: kgPerKm('13.68'),
    },
    {
      materialKey: 'XLPE',
      materialName: 'XLPE insulation',
      consumption: kgPerKm('142'),
      scrap: kgPerKm('4.26'),
    },
  ],
  operations: [
    {
      machineKey: 'RBD',
      machineName: 'Rod breakdown',
      sequence: 1,
      hoursPerKm: hours('2'),
      cores: 1,
    },
    {
      machineKey: 'INSUL',
      machineName: 'Insulation line',
      sequence: 2,
      hoursPerKm: hours('1.5'),
      cores: 4,
    },
  ],
  overheads: [{ key: 'ADMIN', name: 'Administration', amount: omrPerKm('12.5') }],
};

const rates: ResolvedRateSet = {
  asOf: AS_OF,
  materials: new Map([
    [
      'CU50',
      {
        rate: omrPerKg('1.973232'),
        lmeLinked: true,
        drawingPremium: omrPerKg('0.108407'),
        source: source('CU50', 'material_rate'),
      },
    ],
    [
      'XLPE',
      {
        rate: omrPerKg('1.180'),
        lmeLinked: false,
        source: source('XLPE', 'material_rate'),
      },
    ],
  ]),
  machines: new Map([
    ['RBD', { rate: omrPerHour('12.000'), source: source('RBD', 'machine_rate') }],
    ['INSUL', { rate: omrPerHour('18.000'), source: source('INSUL', 'machine_rate') }],
  ]),
  copper: {
    lme: usdPerTonne('4850'),
    fx: omrPerUSD('0.3845'),
    source: source('lme-2026-07-24', 'lme_price'),
  },
};

const terms: CommercialTerms = {
  marginPercent: percent(15),
  drumCost: omrPerKm(0),
  packingCost: omrPerKm(0),
  freightCost: omrPerKm(0),
};

describe('copper driver', () => {
  it('derives metal value as LME × FX ÷ 1000', () => {
    // 4850 × 0.3845 ÷ 1000 = 1.864825 — the workbook's own stated figure
    expect(copperMetalValue(rates.copper).toFixed(6)).toBe('1.864825');
  });

  it('adds the drawing premium for an LME-linked material', () => {
    const cu = rates.materials.get('CU50')!;
    // 1.864825 + 0.108407 = 1.973232, the rate held in the source sheets
    expect(effectiveMaterialRate(cu, rates.copper).toFixed(6)).toBe('1.973232');
  });

  it('leaves a non-linked material on its fixed rate', () => {
    const xlpe = rates.materials.get('XLPE')!;
    expect(effectiveMaterialRate(xlpe, rates.copper).toFixed(3)).toBe('1.180');
  });

  it('reprices copper when the LME moves, and nothing else', () => {
    const higher: ResolvedRateSet = {
      ...rates,
      copper: { ...rates.copper, lme: usdPerTonne('9340') },
    };
    const cu = rates.materials.get('CU50')!;
    const xlpe = rates.materials.get('XLPE')!;

    expect(effectiveMaterialRate(cu, higher.copper).toFixed(6)).toBe('3.699637');
    expect(effectiveMaterialRate(xlpe, higher.copper).toFixed(3)).toBe('1.180');
  });
});

describe('computeCost', () => {
  it('adds scrap as an absolute quantity, as the source sheets hold it', () => {
    const result = computeCost(product, { metres: metres(1000) }, rates, terms);
    if (!result.ok) throw new Error('expected ok');

    const copper = result.value.materials[0]!;
    expect(copper.effectiveConsumption.toFixed(2)).toBe('697.68');
    expect(copper.lmeLinked).toBe(true);
    // 697.68 × 1.973232 = 1,376.6845
    expect(copper.cost.toFixed(4)).toBe('1376.6845');
  });

  it('costs a machine stage as hours × cores × rate', () => {
    const result = computeCost(product, { metres: metres(1000) }, rates, terms);
    if (!result.ok) throw new Error('expected ok');

    const [rbd, insul] = result.value.operations;
    expect(rbd!.hours.toFixed(2)).toBe('2.00'); // 2 × 1 core
    expect(insul!.hours.toFixed(2)).toBe('6.00'); // 1.5 × 4 cores
    expect(insul!.cost.toFixed(3)).toBe('108.000'); // 6 × 18
  });

  it('rolls up as materials + operations + overheads + tooling', () => {
    const result = computeCost(product, { metres: metres(1000) }, rates, terms);
    if (!result.ok) throw new Error('expected ok');
    const b = result.value;

    expect(b.costPerKm.toFixed(6)).toBe(
      b.materialsSubtotal
        .plus(b.operationsSubtotal)
        .plus(b.overheadsSubtotal)
        .plus(b.tooling)
        .toFixed(6),
    );
    expect(b.costPerMetre.toFixed(6)).toBe(b.costPerKm.dividedBy(1000).toFixed(6));
  });

  it('quotes at cost × (1 + margin)', () => {
    const result = computeCost(product, { metres: metres(1000) }, rates, terms);
    if (!result.ok) throw new Error('expected ok');
    const b = result.value;
    expect(b.unitRate.toFixed(8)).toBe(b.costPerMetre.times('1.15').toFixed(8));
  });

  it('counts only LME-linked material toward copper exposure', () => {
    const result = computeCost(product, { metres: metres(1000) }, rates, terms);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.copperMassPerKm.toFixed(2)).toBe('697.68');
  });

  it('refuses to price when a material rate is missing — it does not guess', () => {
    const withoutXlpe: ResolvedRateSet = {
      ...rates,
      materials: new Map([['CU50', rates.materials.get('CU50')!]]),
    };
    const result = computeCost(product, { metres: metres(1000) }, withoutXlpe, terms);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('MISSING_RATE');
      expect(result.error.message).toContain('XLPE insulation');
    }
  });

  it('refuses to price when a machine rate is missing', () => {
    const withoutInsul: ResolvedRateSet = {
      ...rates,
      machines: new Map([['RBD', rates.machines.get('RBD')!]]),
    };
    const result = computeCost(product, { metres: metres(1000) }, withoutInsul, terms);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('UNKNOWN_MACHINE');
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

  it('does not round intermediates — the line total equals rate × quantity', () => {
    const result = computeCost(product, { metres: metres(12000) }, rates, terms);
    if (!result.ok) throw new Error('expected ok');
    const b = result.value;
    expect(b.lineTotal.toFixed(6)).toBe(b.unitRate.times(12000).toFixed(6));
  });
});
