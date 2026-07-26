import { type Decimal, ZERO, sum } from '@/core/decimal';
import { type Result, err, ok } from '@/core/result';
import { omr, type OMR } from '@/core/units';
import type { Actor } from '@/modules/auth';
import type { CostBreakdown } from '@/modules/costing';

/**
 * Quotes.
 *
 * A quote is a promise: this price, for this quantity, until this date, struck
 * on this copper. Everything here exists to make that promise reconstructible
 * — which is why a line carries its whole cost breakdown rather than just a
 * number, and why the strike is stamped on the document itself.
 *
 * Pure. Assembly and totals are decided here; `infra` writes them down.
 */

export type QuoteStatus = 'draft' | 'approved' | 'sent' | 'lapsed';

/**
 * A human's decision about a line, carried onto the quote.
 *
 * Two shapes, one record. `unitRate` set means somebody replaced the price;
 * `unitRate` null means somebody named the product and let the engine cost it.
 * Both are decisions a person made rather than the app, and the spec requires
 * that fact to persist onto the quote and into history — so a quote can answer
 * "who decided this line, and why" without going back to the job.
 *
 * The `reason` is not optional and not decorative. A decided line is the one
 * figure on a quote no machine can explain, so the explanation travels with it.
 */
export interface Decision {
  /** Null when a person chose the product but left the pricing to the engine. */
  readonly unitRate: Decimal | null;
  readonly reason: string;
  readonly by: string;
  readonly at: Date;
}

export interface QuoteLine {
  readonly position: number;
  /** What the customer asked for, verbatim. */
  readonly requestText: string;
  readonly productCode: string;
  readonly sourceSheet: string;
  readonly designation: string;
  readonly quantityMetres: Decimal;
  readonly unitRate: Decimal;
  readonly lineTotal: OMR;
  /**
   * Null when the line was priced by hand off the library.
   *
   * This is deliberately not a synthetic zero-filled breakdown. A line nobody
   * costed has no materials, no machine time and no copper mass, and inventing
   * a tree of zeros would put those claims on an auditable document. `null`
   * plus a stated `override` is the truth; the screens and both exports render
   * it as "priced by hand" rather than as a build-up.
   */
  readonly breakdown: CostBreakdown | null;
  /** Present when a human, not the app, settled this line. */
  readonly decision: Decision | null;
}

export interface Quote {
  readonly id: string;
  readonly number: string;
  readonly status: QuoteStatus;
  readonly customer: string;
  readonly terms: string | null;
  readonly pricedAt: Date;
  readonly validUntil: Date;
  readonly lmeStruck: Decimal;
  readonly fxStruck: Decimal;
  readonly marginPercent: Decimal;
  readonly createdBy: string | null;
  readonly createdAt: Date;
  readonly approvedAt: Date | null;
  /**
   * The quote this one replaced, by number, and the one that replaced it.
   *
   * Both are needed on the screen and they say different things. Looking at a
   * superseded quote, an engineer needs to know the price on it is no longer
   * the one standing; looking at the correction, they need to know what it was
   * correcting and be able to read it.
   */
  readonly supersedes: string | null;
  readonly supersededBy: string | null;
  readonly lines: readonly QuoteLine[];
}

/**
 * How long a price is offered for.
 *
 * Thirty days is the convention, but the real constraint is copper: a quote
 * outlives its usefulness the moment the market moves past the threshold the
 * price watch flags at. The validity date is what makes that expiry explicit
 * to the customer rather than a conversation later.
 */
export const DEFAULT_VALIDITY_DAYS = 30;

export function totalOf(lines: readonly QuoteLine[]): OMR {
  return omr(sum(lines.map((l) => l.lineTotal)));
}

/**
 * Total copper across the quote — what a price move actually acts on.
 *
 * Hand-priced lines contribute nothing, because nobody costed their copper.
 * That means the figure is a **lower bound** on a quote carrying overrides,
 * and `handPricedCount` is what lets a screen say so rather than presenting an
 * understatement as a total.
 */
export function copperMassOf(lines: readonly QuoteLine[]): Decimal {
  return lines.reduce<Decimal>(
    (acc, l) =>
      l.breakdown === null
        ? acc
        : acc.plus(l.breakdown.copperMassPerKm.times(l.quantityMetres).dividedBy(1000)),
    ZERO,
  );
}

/** Lines whose price a person set outright. These carry no build-up. */
export function handPricedCount(lines: readonly QuoteLine[]): number {
  return lines.filter((l) => l.decision?.unitRate != null).length;
}

/** Lines a person settled at all — a hand price or a named product. */
export function decidedCount(lines: readonly QuoteLine[]): number {
  return lines.filter((l) => l.decision !== null).length;
}

/** True when the copper figure understates the quote's real exposure. */
export function copperMassIsPartial(lines: readonly QuoteLine[]): boolean {
  return lines.some((l) => l.breakdown === null);
}

export function isExpired(quote: Quote, at: Date): boolean {
  return quote.validUntil.getTime() <= at.getTime();
}

export type QuoteErrorCode =
  | 'NO_LINES'
  | 'NO_CUSTOMER'
  | 'UNPRICED_LINES'
  | 'ALREADY_APPROVED';

export interface QuoteError {
  readonly code: QuoteErrorCode;
  readonly message: string;
}

export interface DraftLine {
  readonly requestText: string;
  readonly productCode: string;
  readonly sourceSheet: string;
  readonly designation: string;
  readonly quantityMetres: Decimal;
  /** Null for a line priced by hand. */
  readonly breakdown: CostBreakdown | null;
  readonly decision: Decision | null;
}

/**
 * The copper the whole job was resolved against.
 *
 * Passed in rather than read off the first line's breakdown. Line one may be
 * hand-priced and carry no breakdown at all, and a quote whose stamped strike
 * depended on the order its lines happened to arrive in would be a quote that
 * cannot be reconstructed.
 */
export interface Strike {
  readonly lme: Decimal;
  readonly fx: Decimal;
  readonly marginPercent: Decimal;
}

export interface AssembleRequest {
  readonly customer: string;
  readonly lines: readonly DraftLine[];
  /** Lines the engineer could not price. A quote cannot carry them. */
  readonly unpricedCount: number;
  readonly strike: Strike;
  readonly pricedAt: Date;
  readonly validityDays?: number;
  readonly terms?: string | null;
  readonly actor: Actor;
}

export interface AssembledQuote {
  readonly customer: string;
  readonly terms: string | null;
  readonly pricedAt: Date;
  readonly validUntil: Date;
  readonly lmeStruck: Decimal;
  readonly fxStruck: Decimal;
  readonly marginPercent: Decimal;
  readonly lines: readonly Omit<QuoteLine, 'position'>[];
  readonly total: OMR;
}

/**
 * Turns reviewed lines into a quote, or explains why it cannot.
 *
 * The refusal that matters: **a quote cannot be assembled while any line is
 * unpriced.** The spec's rule is that the app never guesses; the corollary is
 * that a document leaving the building never carries a line nobody costed.
 */
export function assembleQuote(
  request: AssembleRequest,
): Result<AssembledQuote, QuoteError> {
  if (request.customer.trim() === '') {
    return err({
      code: 'NO_CUSTOMER',
      message: 'A quote needs a customer. It is going to someone.',
    });
  }

  if (request.lines.length === 0) {
    return err({ code: 'NO_LINES', message: 'A quote with no lines is not a quote.' });
  }

  if (request.unpricedCount > 0) {
    return err({
      code: 'UNPRICED_LINES',
      message:
        `${request.unpricedCount} line${request.unpricedCount === 1 ? '' : 's'} ` +
        'could not be priced. A quote never leaves with a line nobody costed — ' +
        'price them by hand or remove them.',
    });
  }

  const missing = request.lines.filter(
    (l) => l.breakdown === null && l.decision?.unitRate == null,
  );
  if (missing.length > 0) {
    return err({
      code: 'UNPRICED_LINES',
      message:
        `${missing.length} line${missing.length === 1 ? '' : 's'} ` +
        'reached assembly with neither a cost build-up nor a hand price. ' +
        'That is a bug, not a decision — nothing is quoted from it.',
    });
  }

  const validityDays = request.validityDays ?? DEFAULT_VALIDITY_DAYS;

  const lines = request.lines.map((l) => {
    // A stated rate wins where there is one: a person looked at the engine's
    // number and decided a different one was right. A decision without a rate
    // is a choice of product, and the engine still does the arithmetic.
    const unitRate = l.decision?.unitRate ?? l.breakdown!.unitRate;
    return {
      requestText: l.requestText,
      productCode: l.productCode,
      sourceSheet: l.sourceSheet,
      designation: l.designation,
      quantityMetres: l.quantityMetres,
      unitRate,
      lineTotal: omr(unitRate.times(l.quantityMetres)),
      breakdown: l.breakdown,
      decision: l.decision,
    };
  });

  return ok({
    customer: request.customer.trim(),
    terms: request.terms ?? null,
    pricedAt: request.pricedAt,
    validUntil: new Date(
      request.pricedAt.getTime() + validityDays * 24 * 60 * 60 * 1000,
    ),
    // Every line in one quote is struck on the same rate resolution, so the
    // strike is a property of the quote rather than of each line.
    lmeStruck: request.strike.lme,
    fxStruck: request.strike.fx,
    marginPercent: request.strike.marginPercent,
    lines,
    total: omr(sum(lines.map((l) => l.lineTotal))),
  });
}

/**
 * Quote numbers, sequential within a year: Q-2026-0001.
 *
 * Derived from the count so far rather than a database sequence, so the number
 * is a fact about the quote rather than about the insert order — and so a
 * failed insert does not silently burn a number a customer might ask about.
 */
export function nextQuoteNumber(year: number, existingThisYear: number): string {
  return `Q-${year}-${String(existingThisYear + 1).padStart(4, '0')}`;
}
