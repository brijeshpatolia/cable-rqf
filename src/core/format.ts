import { Decimal } from './decimal';

/**
 * The display boundary. This is the *only* place rounding happens
 * (PROJECT_PLAN.md §2.1). Everything upstream carries full precision.
 *
 * The formatting rules here are what make a column of figures read like a
 * ledger: fixed decimals per column type, trailing zeros kept, thousands
 * separated, zero as a value and `—` as its absence.
 */

/** Rounding precision by what the number *is*, not by where it's shown. */
export const PRECISION = {
  /** Cost per km — 3 dp */
  costPerKm: 3,
  /** Cost per metre — 4 dp, because a tenth of a baisa over 40 km is real money */
  costPerMetre: 4,
  /** Unit rate quoted to the customer — 3 dp OMR */
  unitRate: 3,
  /** Line and quote totals — 2 dp OMR */
  total: 2,
  /** Material consumption — 3 dp kg/km */
  weight: 3,
  /** Machine time — 2 dp hours */
  hours: 2,
  /** Percentages — 1 dp */
  percent: 1,
  /** LME quote — 2 dp USD/t */
  lme: 2,
  /** FX — 4 dp */
  fx: 4,
} as const;

export type PrecisionKey = keyof typeof PRECISION;

/** The em-dash used for *no value exists*. Zero is never rendered as this. */
export const ABSENT = '—';

/**
 * Format a Decimal for display. Trailing zeros are kept — ragged decimals
 * break the alignment that makes the column readable.
 */
export function formatNumber(
  value: Decimal | null | undefined,
  decimals: number,
  options: { readonly separator?: boolean } = {},
): string {
  if (value === null || value === undefined) return ABSENT;

  const { separator = true } = options;
  const fixed = value.toFixed(decimals, Decimal.ROUND_HALF_UP);
  if (!separator) return fixed;

  const negative = fixed.startsWith('-');
  const unsigned = negative ? fixed.slice(1) : fixed;
  const [whole = '0', fraction] = unsigned.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const body = fraction === undefined ? grouped : `${grouped}.${fraction}`;

  return negative ? `-${body}` : body;
}

/** Format by semantic kind, so a rate always looks like a rate everywhere. */
export function format(
  value: Decimal | null | undefined,
  kind: PrecisionKey,
): string {
  return formatNumber(value, PRECISION[kind]);
}

/**
 * Absolute timestamps with timezone, always (DESIGN_SYSTEM.md §9). An engineer
 * reconstructing a quote needs the actual time, not "2 hours ago".
 */
export function formatInstant(at: Date, timeZone = 'Asia/Muscat'): string {
  const date = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone,
  }).format(at);

  const time = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone,
  }).format(at);

  return `${date} ${time} GST`;
}

/** Date only — effective dates on rate rows. */
export function formatDate(at: Date, timeZone = 'Asia/Muscat'): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone,
  }).format(at);
}
