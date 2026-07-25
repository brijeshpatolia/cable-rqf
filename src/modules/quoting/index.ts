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
  readonly breakdown: CostBreakdown;
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

/** Total copper across the quote — what a price move actually acts on. */
export function copperMassOf(lines: readonly QuoteLine[]): Decimal {
  return lines.reduce<Decimal>(
    (acc, l) =>
      acc.plus(l.breakdown.copperMassPerKm.times(l.quantityMetres).dividedBy(1000)),
    ZERO,
  );
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
  readonly breakdown: CostBreakdown;
}

export interface AssembleRequest {
  readonly customer: string;
  readonly lines: readonly DraftLine[];
  /** Lines the engineer could not price. A quote cannot carry them. */
  readonly unpricedCount: number;
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

  const first = request.lines[0]!.breakdown;
  const validityDays = request.validityDays ?? DEFAULT_VALIDITY_DAYS;

  const lines = request.lines.map((l) => ({
    requestText: l.requestText,
    productCode: l.productCode,
    sourceSheet: l.sourceSheet,
    designation: l.designation,
    quantityMetres: l.quantityMetres,
    unitRate: l.breakdown.unitRate,
    lineTotal: l.breakdown.lineTotal,
    breakdown: l.breakdown,
  }));

  return ok({
    customer: request.customer.trim(),
    terms: request.terms ?? null,
    pricedAt: request.pricedAt,
    validUntil: new Date(
      request.pricedAt.getTime() + validityDays * 24 * 60 * 60 * 1000,
    ),
    // Every line in one quote is struck on the same rate resolution, so the
    // strike is a property of the quote rather than of each line.
    lmeStruck: first.strike.lme,
    fxStruck: first.strike.fx,
    marginPercent: first.commercial.marginPercent,
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
