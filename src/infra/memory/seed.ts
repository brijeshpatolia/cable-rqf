import { type Decimal, dec } from '@/core/decimal';
import {
  hours,
  kgPerKm,
  omr,
  omrPerKm,
  percent,
  usdPerTonne,
} from '@/core/units';
import type { BomLine, MachineOp, Product } from '@/modules/costing/types';
import type { EffectiveRow } from '@/modules/rates/effective';
import type { AuditEvent, LmeTick } from '@/modules/rates/ports';
import type { OpenQuote } from '@/modules/pricewatch/drift';

/**
 * Seed data.
 *
 * Stands in for the imported 99 sheets until Nuhas confirms they're current
 * and the Phase 0 import runs. The *shapes* are final — this is the same data
 * the database adapter will return — but the numbers are illustrative and are
 * marked as such in the UI.
 */

const APR = new Date('2026-04-01T00:00:00Z');
const JAN = new Date('2026-01-01T00:00:00Z');
const TODAY = new Date('2026-07-24T04:00:00Z');

export const NOW = new Date('2026-07-24T10:20:00Z');

const eff = (
  key: string,
  value: string,
  rateId: string,
  table: string,
  validFrom: Date = JAN,
  validTo: Date | null = null,
): EffectiveRow<Decimal> => ({
  key,
  value: dec(value),
  validFrom,
  validTo,
  rateId,
  table,
});

// ── Material rates ─────────────────────────────────────────────────────
// A representative slice of the 133. Two carry closed history so the Rate
// Desk's audit trail has something real to show.
export const MATERIAL_ROWS: readonly EffectiveRow<Decimal>[] = [
  eff('XLPE', '1.100', '12a', 'material_rate', JAN, APR),
  eff('XLPE', '1.180', '12', 'material_rate', APR),
  eff('PVC_ST2', '0.486', '58a', 'material_rate', JAN, APR),
  eff('PVC_ST2', '0.510', '58', 'material_rate', APR),
  eff('GSW', '0.680', '41', 'material_rate'),
  eff('PP_FILLER', '0.740', '66', 'material_rate'),
  eff('LSOH', '1.640', '73', 'material_rate'),
  eff('AL_TAPE', '1.220', '81', 'material_rate'),
  eff('CU_TAPE', '4.180', '88', 'material_rate'),
  eff('SEMICON', '2.340', '94', 'material_rate'),
  eff('BINDER', '0.920', '101', 'material_rate'),
];

// ── Machine rates ──────────────────────────────────────────────────────
export const MACHINE_ROWS: readonly EffectiveRow<Decimal>[] = [
  eff('RBD', '14.500', '3', 'machine_rate'),
  eff('STRAND', '16.200', '7', 'machine_rate'),
  eff('INSUL', '22.400', '11', 'machine_rate'),
  eff('LAYUP', '15.800', '16', 'machine_rate'),
  eff('ARMOUR', '19.600', '21', 'machine_rate'),
  eff('SHEATH', '17.300', '26', 'machine_rate'),
  eff('SCREEN', '18.900', '29', 'machine_rate'),
  eff('CCV', '31.500', '34', 'machine_rate'),
];

export const DRAWING_PREMIUM: ReadonlyMap<string, Decimal> = new Map([
  ['1.5', dec('0.612')],
  ['2.5', dec('0.548')],
  ['4', dec('0.497')],
  ['6', dec('0.451')],
  ['10', dec('0.418')],
  ['16', dec('0.384')],
  ['25', dec('0.341')],
  ['35', dec('0.316')],
  ['50', dec('0.293')],
  ['70', dec('0.271')],
  ['95', dec('0.254')],
  ['120', dec('0.241')],
  ['150', dec('0.232')],
  ['185', dec('0.224')],
  ['240', dec('0.216')],
  ['300', dec('0.209')],
]);

export const LME_HISTORY: readonly LmeTick[] = [
  { at: TODAY, lme: dec('9340.00'), fx: dec('0.3845'), enteredBy: 'B. Patolia' },
  {
    at: new Date('2026-07-23T04:00:00Z'),
    lme: dec('9180.00'),
    fx: dec('0.3845'),
    enteredBy: 'B. Patolia',
  },
  {
    at: new Date('2026-07-22T04:00:00Z'),
    lme: dec('9215.50'),
    fx: dec('0.3845'),
    enteredBy: 'B. Patolia',
  },
  {
    at: new Date('2026-07-21T04:00:00Z'),
    lme: dec('9102.00'),
    fx: dec('0.3845'),
    enteredBy: 'auto (LME feed)',
  },
  {
    at: new Date('2026-07-18T04:00:00Z'),
    lme: dec('8994.00'),
    fx: dec('0.3845'),
    enteredBy: 'auto (LME feed)',
  },
];

// ── Products ───────────────────────────────────────────────────────────

const ops = (spec: readonly [string, string, number, boolean][]): MachineOp[] =>
  spec.map(([machineKey, machineName, h, scales], i) => ({
    machineKey,
    machineName,
    sequence: i + 1,
    hoursPerKm: hours(h),
    scalesWithCores: scales,
  }));

const bom = (spec: readonly [string, string, number, number][]): BomLine[] =>
  spec.map(([materialKey, materialName, consumption, scrap]) => ({
    materialKey,
    materialName,
    consumption: kgPerKm(consumption),
    scrapPercent: percent(scrap),
  }));

const OVERHEADS = [
  { key: 'TOOL', name: 'Tooling', amount: omrPerKm(62) },
  { key: 'QC', name: 'Quality & routine test', amount: omrPerKm(38) },
  { key: 'FACTORY', name: 'Factory overhead', amount: omrPerKm(58) },
  { key: 'ADMIN', name: 'Administration', amount: omrPerKm(30) },
];

const STANDARD_OPS = ops([
  ['RBD', 'Rod breakdown & annealing', 1.8, false],
  ['STRAND', 'Stranding', 1.2, true],
  ['INSUL', 'CV insulation line', 1.5, true],
  ['LAYUP', 'Laying up', 2.1, false],
  ['ARMOUR', 'Armouring', 2.6, false],
  ['SHEATH', 'Outer sheathing', 1.9, false],
]);

const UNARMOURED_OPS = ops([
  ['RBD', 'Rod breakdown & annealing', 1.8, false],
  ['STRAND', 'Stranding', 1.2, true],
  ['INSUL', 'CV insulation line', 1.5, true],
  ['LAYUP', 'Laying up', 1.6, false],
  ['SHEATH', 'Outer sheathing', 1.9, false],
]);

export const PRODUCTS: readonly Product[] = [
  {
    id: 'NCP-4C-50-XLPE-SWA',
    designation: '4C × 50mm² Cu XLPE SWA PVC 0.6/1kV',
    cores: 4,
    sizeMm2: dec(50),
    family: 'LV Power',
    bom: bom([
      ['CU_CONDUCTOR', 'Copper conductor', 684, 2],
      ['XLPE', 'XLPE insulation', 142, 3],
      ['GSW', 'Galvanised steel wire', 412, 2.5],
      ['PVC_ST2', 'PVC sheath ST2', 186, 3],
      ['PP_FILLER', 'PP filler & binder', 48, 4],
    ]),
    operations: STANDARD_OPS,
    overheads: OVERHEADS,
  },
  {
    id: 'NCP-3C-25-XLPE-SWA',
    designation: '3C × 25mm² Cu XLPE SWA PVC 0.6/1kV',
    cores: 3,
    sizeMm2: dec(25),
    family: 'LV Power',
    bom: bom([
      ['CU_CONDUCTOR', 'Copper conductor', 256, 2],
      ['XLPE', 'XLPE insulation', 88, 3],
      ['GSW', 'Galvanised steel wire', 298, 2.5],
      ['PVC_ST2', 'PVC sheath ST2', 132, 3],
      ['PP_FILLER', 'PP filler & binder', 34, 4],
    ]),
    operations: STANDARD_OPS,
    overheads: OVERHEADS,
  },
  {
    id: 'NCP-4C-16-XLPE-SWA',
    designation: '4C × 16mm² Cu XLPE SWA PVC 0.6/1kV',
    cores: 4,
    sizeMm2: dec(16),
    family: 'LV Power',
    bom: bom([
      ['CU_CONDUCTOR', 'Copper conductor', 218, 2],
      ['XLPE', 'XLPE insulation', 71, 3],
      ['GSW', 'Galvanised steel wire', 264, 2.5],
      ['PVC_ST2', 'PVC sheath ST2', 118, 3],
      ['PP_FILLER', 'PP filler & binder', 28, 4],
    ]),
    operations: STANDARD_OPS,
    overheads: OVERHEADS,
  },
  {
    id: 'NCP-1C-240-XLPE-UA',
    designation: '1C × 240mm² Cu XLPE PVC 0.6/1kV',
    cores: 1,
    sizeMm2: dec(240),
    family: 'LV Power',
    bom: bom([
      ['CU_CONDUCTOR', 'Copper conductor', 2164, 2],
      ['XLPE', 'XLPE insulation', 196, 3],
      ['PVC_ST2', 'PVC sheath ST2', 214, 3],
    ]),
    operations: UNARMOURED_OPS,
    overheads: OVERHEADS,
  },
  {
    id: 'NCP-4C-50-LSOH-SWA',
    designation: '4C × 50mm² Cu XLPE SWA LSOH 0.6/1kV',
    cores: 4,
    sizeMm2: dec(50),
    family: 'LV Power (LSOH)',
    bom: bom([
      ['CU_CONDUCTOR', 'Copper conductor', 684, 2],
      ['XLPE', 'XLPE insulation', 142, 3],
      ['GSW', 'Galvanised steel wire', 412, 2.5],
      ['LSOH', 'LSOH sheath', 191, 3],
      ['PP_FILLER', 'PP filler & binder', 48, 4],
    ]),
    operations: STANDARD_OPS,
    overheads: OVERHEADS,
  },
  {
    id: 'NCP-3C-95-MV-11',
    designation: '3C × 95mm² Cu XLPE SWA PVC 11kV',
    cores: 3,
    sizeMm2: dec(95),
    family: 'MV Power',
    bom: bom([
      ['CU_CONDUCTOR', 'Copper conductor', 934, 2],
      ['XLPE', 'XLPE insulation', 486, 3],
      ['SEMICON', 'Semiconducting screen', 128, 4],
      ['CU_TAPE', 'Copper tape screen', 214, 3],
      ['GSW', 'Galvanised steel wire', 528, 2.5],
      ['PVC_ST2', 'PVC sheath ST2', 268, 3],
    ]),
    operations: ops([
      ['RBD', 'Rod breakdown & annealing', 1.8, false],
      ['STRAND', 'Stranding', 1.4, true],
      ['CCV', 'CCV triple extrusion line', 3.2, true],
      ['SCREEN', 'Screening', 1.8, true],
      ['LAYUP', 'Laying up', 2.4, false],
      ['ARMOUR', 'Armouring', 2.9, false],
      ['SHEATH', 'Outer sheathing', 2.1, false],
    ]),
    overheads: [
      { key: 'TOOL', name: 'Tooling', amount: omrPerKm(148) },
      { key: 'QC', name: 'Quality & routine test', amount: omrPerKm(212) },
      { key: 'FACTORY', name: 'Factory overhead', amount: omrPerKm(96) },
      { key: 'ADMIN', name: 'Administration', amount: omrPerKm(44) },
    ],
  },
  {
    id: 'NCP-2C-6-XLPE-UA',
    designation: '2C × 6mm² Cu XLPE PVC 0.6/1kV',
    cores: 2,
    sizeMm2: dec(6),
    family: 'LV Control',
    bom: bom([
      ['CU_CONDUCTOR', 'Copper conductor', 116, 2],
      ['XLPE', 'XLPE insulation', 42, 3],
      ['PVC_ST2', 'PVC sheath ST2', 68, 3],
    ]),
    operations: UNARMOURED_OPS,
    overheads: OVERHEADS,
  },
  {
    id: 'NCP-12C-2.5-CTRL',
    designation: '12C × 2.5mm² Cu PVC SWA PVC control',
    cores: 12,
    sizeMm2: dec('2.5'),
    family: 'LV Control',
    bom: bom([
      ['CU_CONDUCTOR', 'Copper conductor', 288, 2],
      ['PVC_ST2', 'PVC insulation & sheath', 342, 3],
      ['GSW', 'Galvanised steel wire', 386, 2.5],
      ['BINDER', 'Binder tape', 22, 4],
    ]),
    operations: STANDARD_OPS,
    overheads: OVERHEADS,
  },
];

// ── Open quotes, for the price watch ───────────────────────────────────
export const OPEN_QUOTES: readonly OpenQuote[] = [
  {
    quoteId: 'Q-2026-0148',
    customer: 'Muscat Electricals LLC',
    struckLme: usdPerTonne('9340.00'),
    struckAt: new Date('2026-07-24T04:00:00Z'),
    expiresAt: new Date('2026-08-23T00:00:00Z'),
    value: omr('59916.54'),
    copperMassKg: dec('8372.16'),
    fx: dec('0.3845'),
  },
  {
    quoteId: 'Q-2026-0141',
    customer: 'Sohar Industrial Contracting',
    struckLme: usdPerTonne('8994.00'),
    struckAt: new Date('2026-07-18T04:00:00Z'),
    expiresAt: new Date('2026-08-17T00:00:00Z'),
    value: omr('142380.20'),
    copperMassKg: dec('24618.40'),
    fx: dec('0.3845'),
  },
  {
    quoteId: 'Q-2026-0137',
    customer: 'Duqm Port Authority',
    struckLme: usdPerTonne('9102.00'),
    struckAt: new Date('2026-07-21T04:00:00Z'),
    expiresAt: new Date('2026-08-20T00:00:00Z'),
    value: omr('38204.75'),
    copperMassKg: dec('5140.80'),
    fx: dec('0.3845'),
  },
  {
    quoteId: 'Q-2026-0129',
    customer: 'Salalah Methanol',
    struckLme: usdPerTonne('9215.50'),
    struckAt: new Date('2026-06-22T04:00:00Z'),
    expiresAt: new Date('2026-07-22T00:00:00Z'),
    value: omr('21486.00'),
    copperMassKg: dec('3012.40'),
    fx: dec('0.3845'),
  },
];

export const AUDIT: readonly AuditEvent[] = [
  {
    at: new Date('2026-07-24T04:00:00Z'),
    actor: 'B. Patolia',
    entity: 'lme_price',
    field: 'LME',
    previous: '9,180.00',
    next: '9,340.00',
  },
  {
    at: new Date('2026-04-01T06:12:00Z'),
    actor: 'B. Patolia',
    entity: 'material_rate:XLPE',
    field: 'rate',
    previous: '1.100',
    next: '1.180',
    reason: 'Supplier price revision, Q2 contract',
  },
  {
    at: new Date('2026-04-01T06:14:00Z'),
    actor: 'B. Patolia',
    entity: 'material_rate:PVC_ST2',
    field: 'rate',
    previous: '0.486',
    next: '0.510',
    reason: 'Supplier price revision, Q2 contract',
  },
];
