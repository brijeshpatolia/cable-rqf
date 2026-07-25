import { type Decimal, dec, ZERO } from '@/core/decimal';
import { omr, type OMR, type USDPerTonne } from '@/core/units';

/**
 * Live price watch.
 *
 * A quote struck on Monday's copper is a promise made on Monday's copper. When
 * the market moves past a threshold before the quote expires, every affected
 * quote is flagged — with the number it was struck on, the number now, and
 * what the move is worth on that quote's actual copper mass.
 *
 * Deterministic and pure, like everything in modules/.
 */

export interface OpenQuote {
  /**
   * The quote's human-facing number, `Q-2026-0148`. Not the row id: this is
   * what the watch shows, what an engineer searches for, and what a customer
   * quotes back down the phone.
   */
  readonly number: string;
  readonly customer: string;
  readonly struckLme: USDPerTonne;
  readonly struckAt: Date;
  readonly expiresAt: Date;
  readonly value: OMR;
  /** Total copper in the quote, in kg — the exposure the move acts on. */
  readonly copperMassKg: Decimal;
  /** The FX the quote was struck on, so exposure is expressed in OMR. */
  readonly fx: Decimal;
}

export type DriftStatus = 'within' | 'breached' | 'lapsed';

export interface DriftResult {
  readonly quote: OpenQuote;
  readonly status: DriftStatus;
  /** Signed move in USD/t since the quote was struck. */
  readonly lmeDelta: Decimal;
  /** Signed move as a percentage of the struck price. */
  readonly lmePercent: Decimal;
  /** What the move is worth on this quote's copper, in OMR. Signed. */
  readonly exposure: OMR;
  readonly daysToExpiry: number;
}

const KG_PER_TONNE = dec(1000);
const MS_PER_DAY = 86_400_000;

/**
 * Default threshold. A quote is flagged when copper has moved more than this
 * percentage either way — a fall matters as much as a rise, because a quote
 * priced high enough to lose the order is also a problem.
 */
export const DEFAULT_THRESHOLD_PERCENT = dec('2.5');

export function assessDrift(
  quote: OpenQuote,
  currentLme: USDPerTonne,
  now: Date,
  thresholdPercent: Decimal = DEFAULT_THRESHOLD_PERCENT,
): DriftResult {
  const lmeDelta = currentLme.minus(quote.struckLme);

  const lmePercent = quote.struckLme.isZero()
    ? ZERO
    : lmeDelta.dividedBy(quote.struckLme).times(100);

  // Move per kg in OMR, applied to the quote's actual copper mass.
  const exposure = omr(
    lmeDelta.times(quote.fx).dividedBy(KG_PER_TONNE).times(quote.copperMassKg),
  );

  const msToExpiry = quote.expiresAt.getTime() - now.getTime();
  const daysToExpiry = Math.ceil(msToExpiry / MS_PER_DAY);

  const status: DriftStatus =
    msToExpiry <= 0
      ? 'lapsed'
      : lmePercent.abs().greaterThan(thresholdPercent)
        ? 'breached'
        : 'within';

  return { quote, status, lmeDelta, lmePercent, exposure, daysToExpiry };
}

export interface DriftSweep {
  readonly results: readonly DriftResult[];
  readonly breached: readonly DriftResult[];
  readonly currentLme: USDPerTonne;
  /** Total OMR at risk across every breached quote. Signed. */
  readonly totalExposure: OMR;
}

/**
 * The sweep that runs on every LME change. Lapsed quotes are reported but are
 * never counted as exposure — an expired promise costs nothing.
 */
export function sweep(
  quotes: readonly OpenQuote[],
  currentLme: USDPerTonne,
  now: Date,
  thresholdPercent: Decimal = DEFAULT_THRESHOLD_PERCENT,
): DriftSweep {
  const results = quotes
    .map((q) => assessDrift(q, currentLme, now, thresholdPercent))
    .sort((a, b) => b.exposure.abs().comparedTo(a.exposure.abs()));

  const breached = results.filter((r) => r.status === 'breached');

  return {
    results,
    breached,
    currentLme,
    totalExposure: omr(
      breached.reduce<Decimal>((acc, r) => acc.plus(r.exposure), ZERO),
    ),
  };
}

/**
 * The sentence the spec asks for, verbatim in shape:
 * "3 open quotes were priced at LME 9,340. Copper is now 9,720."
 */
export function driftHeadline(s: DriftSweep): string | null {
  if (s.breached.length === 0) return null;

  const struck = s.breached.map((r) => r.quote.struckLme);
  const low = struck.reduce((a, b) => (a.lessThan(b) ? a : b));
  const high = struck.reduce((a, b) => (a.greaterThan(b) ? a : b));

  // One struck price reads as a single figure; a spread reads as a range.
  // "at LME various LME prices" is the phrasing this avoids.
  const at = low.equals(high)
    ? `at LME ${group(low)}`
    : `between LME ${group(low)} and ${group(high)}`;

  const noun = s.breached.length === 1 ? 'quote was' : 'quotes were';

  return `${s.breached.length} open ${noun} priced ${at}. Copper is now ${group(s.currentLme)}.`;
}

/** Thousands separators, so prose numbers match the ledger. */
function group(value: Decimal): string {
  return value.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
