import { dec, type Decimal } from '@/core/decimal';
import { omr, usdPerTonne } from '@/core/units';
import { DRIVERS, RAW_MACHINES, RAW_MATERIALS } from '@/infra/data';
import type { EffectiveRow } from '@/modules/rates';
import type { AuditEvent, LmeTick } from '@/modules/rates';
import type { OpenQuote } from '@/modules/pricewatch';

/**
 * Seed data.
 *
 * Products, materials, machines, and the copper driver all come from the
 * imported cost master (`src/infra/data`). What remains here is what the
 * workbook has no equivalent for — the LME series, quote history, and the
 * audit log — which the app will accumulate itself once it is running.
 */

/** The instant the app treats as "now" until it reads a real clock. */
export const NOW = new Date('2026-07-24T10:20:00Z');

const IMPORTED = new Date('2026-01-01T00:00:00Z');

/**
 * Rate rows, derived from the import so the Rate Desk shows the real 133
 * materials and 34 machines rather than a hand-written sample. Every row is
 * open-ended from the import date: the workbook carries no rate history, so
 * inventing effective periods would be fiction. History starts accruing the
 * first time the Rate Owner edits a rate in the app.
 */
export const MATERIAL_ROWS: readonly EffectiveRow<Decimal>[] = RAW_MATERIALS.map(
  (m) => ({
    key: m.code,
    value: dec(m.rate),
    validFrom: IMPORTED,
    validTo: null,
    rateId: m.code,
    table: 'material_rate',
  }),
);

export const MACHINE_ROWS: readonly EffectiveRow<Decimal>[] = RAW_MACHINES.map(
  (m) => ({
    key: m.code,
    value: dec(m.rate),
    validFrom: IMPORTED,
    validTo: null,
    rateId: m.code,
    table: 'machine_rate',
  }),
);

/**
 * The LME series.
 *
 * The oldest entry is the workbook's own driver — every source sheet was
 * costed at USD 4,850/t. The entries above it are where copper has since gone,
 * and the gap between the two is precisely the stale-pricing problem this app
 * exists to fix.
 */
export const LME_HISTORY: readonly LmeTick[] = [
  {
    at: new Date('2026-07-24T04:00:00Z'),
    lme: dec('9340.00'),
    fx: DRIVERS.fx,
    enteredBy: 'B. Patolia',
  },
  {
    at: new Date('2026-07-23T04:00:00Z'),
    lme: dec('9180.00'),
    fx: DRIVERS.fx,
    enteredBy: 'B. Patolia',
  },
  {
    at: new Date('2026-07-22T04:00:00Z'),
    lme: dec('9215.50'),
    fx: DRIVERS.fx,
    enteredBy: 'B. Patolia',
  },
  {
    at: new Date('2026-07-21T04:00:00Z'),
    lme: dec('9102.00'),
    fx: DRIVERS.fx,
    enteredBy: 'auto (LME feed)',
  },
  {
    at: IMPORTED,
    lme: DRIVERS.lme,
    fx: DRIVERS.fx,
    enteredBy: 'imported — cost master basis',
  },
];

export const OPEN_QUOTES: readonly OpenQuote[] = [
  {
    quoteId: 'Q-2026-0148',
    customer: 'Muscat Electricals LLC',
    struckLme: usdPerTonne('9340.00'),
    struckAt: new Date('2026-07-24T04:00:00Z'),
    expiresAt: new Date('2026-08-23T00:00:00Z'),
    value: omr('59916.54'),
    copperMassKg: dec('8372.16'),
    fx: DRIVERS.fx,
  },
  {
    quoteId: 'Q-2026-0141',
    customer: 'Sohar Industrial Contracting',
    struckLme: usdPerTonne('8994.00'),
    struckAt: new Date('2026-07-18T04:00:00Z'),
    expiresAt: new Date('2026-08-17T00:00:00Z'),
    value: omr('142380.20'),
    copperMassKg: dec('24618.40'),
    fx: DRIVERS.fx,
  },
  {
    quoteId: 'Q-2026-0137',
    customer: 'Duqm Port Authority',
    struckLme: usdPerTonne('9102.00'),
    struckAt: new Date('2026-07-21T04:00:00Z'),
    expiresAt: new Date('2026-08-20T00:00:00Z'),
    value: omr('38204.75'),
    copperMassKg: dec('5140.80'),
    fx: DRIVERS.fx,
  },
  {
    quoteId: 'Q-2026-0129',
    customer: 'Salalah Methanol',
    struckLme: usdPerTonne('9215.50'),
    struckAt: new Date('2026-06-22T04:00:00Z'),
    expiresAt: new Date('2026-07-22T00:00:00Z'),
    value: omr('21486.00'),
    copperMassKg: dec('3012.40'),
    fx: DRIVERS.fx,
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
    at: IMPORTED,
    actor: 'import',
    entity: 'cost_master',
    field: 'all rates',
    previous: '—',
    next: '133 materials, 34 machines, 99 products',
    reason: 'Initial import from Nuhas_Cost_Master.xlsx',
  },
];
