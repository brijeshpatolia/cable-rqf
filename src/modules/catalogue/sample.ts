import { dec } from '@/core/decimal';
import {
  hours,
  kgPerKm,
  omrPerHour,
  omrPerKg,
  omrPerKm,
  omrPerUSD,
  percent,
  usdPerTonne,
} from '@/core/units';
import type {
  CommercialTerms,
  Product,
  ResolvedRateSet,
} from '@/modules/costing/types';

/**
 * Representative sample data, standing in for the imported 99 sheets until
 * the Phase 0 import lands. Shapes are final; the numbers are illustrative.
 */

export const SAMPLE_AS_OF = new Date('2026-07-24T10:20:00Z');

const src = (rateId: string, table: string) => ({
  rateId,
  effectiveFrom: new Date('2026-07-24T04:00:00Z'),
  table,
});

export const SAMPLE_PRODUCT: Product = {
  id: 'NCP-4C-50-XLPE-SWA',
  designation: '4C × 50mm² Cu XLPE SWA PVC 0.6/1kV',
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
    {
      materialKey: 'GSW',
      materialName: 'Galvanised steel wire',
      consumption: kgPerKm(412),
      scrapPercent: percent(2.5),
    },
    {
      materialKey: 'PVC_ST2',
      materialName: 'PVC sheath ST2',
      consumption: kgPerKm(186),
      scrapPercent: percent(3),
    },
    {
      materialKey: 'PP_FILLER',
      materialName: 'PP filler & binder',
      consumption: kgPerKm(48),
      scrapPercent: percent(4),
    },
  ],
  operations: [
    {
      machineKey: 'RBD',
      machineName: 'Rod breakdown & annealing',
      sequence: 1,
      hoursPerKm: hours(1.8),
      scalesWithCores: false,
    },
    {
      machineKey: 'STRAND',
      machineName: 'Stranding',
      sequence: 2,
      hoursPerKm: hours(1.2),
      scalesWithCores: true,
    },
    {
      machineKey: 'INSUL',
      machineName: 'CV insulation line',
      sequence: 3,
      hoursPerKm: hours(1.5),
      scalesWithCores: true,
    },
    {
      machineKey: 'LAYUP',
      machineName: 'Laying up',
      sequence: 4,
      hoursPerKm: hours(2.1),
      scalesWithCores: false,
    },
    {
      machineKey: 'ARMOUR',
      machineName: 'Armouring',
      sequence: 5,
      hoursPerKm: hours(2.6),
      scalesWithCores: false,
    },
    {
      machineKey: 'SHEATH',
      machineName: 'Outer sheathing',
      sequence: 6,
      hoursPerKm: hours(1.9),
      scalesWithCores: false,
    },
  ],
  overheads: [
    { key: 'TOOL', name: 'Tooling', amount: omrPerKm(62) },
    { key: 'QC', name: 'Quality & routine test', amount: omrPerKm(38) },
    { key: 'FACTORY', name: 'Factory overhead', amount: omrPerKm(58) },
    { key: 'ADMIN', name: 'Administration', amount: omrPerKm(30) },
  ],
};

export const SAMPLE_RATES: ResolvedRateSet = {
  asOf: SAMPLE_AS_OF,
  materials: new Map([
    ['XLPE', { rate: omrPerKg('1.180'), source: src('12', 'material_rate') }],
    ['GSW', { rate: omrPerKg('0.680'), source: src('41', 'material_rate') }],
    ['PVC_ST2', { rate: omrPerKg('0.510'), source: src('58', 'material_rate') }],
    ['PP_FILLER', { rate: omrPerKg('0.740'), source: src('66', 'material_rate') }],
  ]),
  machines: new Map([
    ['RBD', { rate: omrPerHour('14.500'), source: src('3', 'machine_rate') }],
    ['STRAND', { rate: omrPerHour('16.200'), source: src('7', 'machine_rate') }],
    ['INSUL', { rate: omrPerHour('22.400'), source: src('11', 'machine_rate') }],
    ['LAYUP', { rate: omrPerHour('15.800'), source: src('16', 'machine_rate') }],
    ['ARMOUR', { rate: omrPerHour('19.600'), source: src('21', 'machine_rate') }],
    ['SHEATH', { rate: omrPerHour('17.300'), source: src('26', 'machine_rate') }],
  ]),
  copper: {
    lme: usdPerTonne('9340.00'),
    fx: omrPerUSD('0.3845'),
    drawingPremiumBySize: new Map([
      ['1.5', omrPerKg('0.612')],
      ['16', omrPerKg('0.384')],
      ['50', omrPerKg('0.293')],
      ['240', omrPerKg('0.216')],
    ]),
    source: src('lme-2026-07-24', 'lme_price'),
  },
};

export const SAMPLE_TERMS: CommercialTerms = {
  marginPercent: percent(24),
  drumCost: omrPerKm(84),
  packingCost: omrPerKm(26),
  freightCost: omrPerKm(112),
};
