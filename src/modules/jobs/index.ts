import type { Decimal } from '@/core/decimal';
import { type Result, err, ok } from '@/core/result';
import type { Actor } from '@/modules/auth';
import type { LineDecision, Override, ProductChoice } from '@/modules/matching';

/**
 * Jobs — an RFQ under review.
 *
 * A job holds the customer's text and **the decisions a human made about it**,
 * not the prices. Prices are recomputed on every render from the rates in
 * force, so a job left open across a copper move reprices rather than going
 * stale, and freezing happens exactly once: at approval, into the quote.
 *
 * That split is the reason a decision is worth storing at all. "Price line 4
 * as product X, because the customer confirmed it" stays true across a
 * repricing. "Line 4 is 6.030" does not.
 *
 * Pure. `infra` writes it down; nothing here knows a database exists.
 */

export type JobStatus = 'review' | 'approved' | 'abandoned';
export type JobSource = 'paste' | 'upload' | 'email';

export interface Job {
  readonly id: string;
  readonly reference: string;
  readonly status: JobStatus;
  readonly customer: string | null;
  readonly terms: string | null;
  readonly source: JobSource;
  readonly sourceName: string | null;
  /** What the document reader made of the file, including what it left out. */
  readonly sourceNotes: readonly string[];
  /** The RFQ exactly as received. Never edited once the job is quoted. */
  readonly rawText: string;
  readonly createdBy: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly quoteNumber: string | null;
  readonly decisions: readonly LineDecision[];
}

/**
 * Job references, sequential within a year: J-2026-0042.
 *
 * Same shape as a quote number and deliberately a different letter — an
 * engineer reading `J-2026-0042` on a screen should never wonder whether it is
 * something a customer has seen.
 */
export function nextJobReference(year: number, existingThisYear: number): string {
  return `J-${year}-${String(existingThisYear + 1).padStart(4, '0')}`;
}

export type DecisionErrorCode =
  | 'NO_REASON'
  | 'NOT_A_DECISION'
  | 'BAD_RATE'
  | 'JOB_CLOSED'
  | 'FORBIDDEN';

export interface DecisionError {
  readonly code: DecisionErrorCode;
  readonly message: string;
}

export interface DecisionRequest {
  readonly job: Pick<Job, 'status' | 'reference'>;
  readonly position: number;
  /** A hand price. Mutually exclusive with `product` is *not* required — an
   *  engineer may name a product and then still override its price. */
  readonly unitRate?: Decimal;
  readonly product?: { readonly code: string; readonly sourceSheet: string };
  readonly reason: string;
  readonly actor: Actor;
  readonly at: Date;
}

export interface PlannedDecision {
  readonly position: number;
  readonly override: Override | null;
  readonly choice: ProductChoice | null;
  /**
   * What changed, in a few words.
   *
   * Deliberately without the line number: the audit row already carries it in
   * `field`, and the screen already says which line it just settled. Putting it
   * here too produced "Line 2 settled. line 2: rate set to 7.5 OMR/m."
   */
  readonly summary: string;
}

/**
 * Decides what a human's answer to a line *is*, or refuses it in words.
 *
 * Every refusal here is also a database constraint. That is not duplication
 * for its own sake: the constraint is the guarantee and this is the sentence
 * the engineer reads. A CHECK violation surfacing as `23514` in a toast would
 * be a guarantee kept and a product failed.
 */
export function planDecision(
  request: DecisionRequest,
): Result<PlannedDecision, DecisionError> {
  if (request.job.status !== 'review') {
    return err({
      code: 'JOB_CLOSED',
      message:
        `${request.job.reference} has already been ${request.job.status}. ` +
        'Its decisions are the record of what was quoted and why, so they no ' +
        'longer change — start a new job if the enquiry has moved on.',
    });
  }

  const reason = request.reason.trim();
  if (reason === '') {
    return err({
      code: 'NO_REASON',
      message:
        'Say why. This is the one figure on the quote no machine can explain, ' +
        'so the explanation has to travel with it.',
    });
  }

  if (request.unitRate === undefined && request.product === undefined) {
    return err({
      code: 'NOT_A_DECISION',
      message: 'Either name a product to price this as, or set a rate by hand.',
    });
  }

  if (request.unitRate !== undefined) {
    if (!request.unitRate.isFinite() || request.unitRate.lessThanOrEqualTo(0)) {
      return err({
        code: 'BAD_RATE',
        message: 'A hand price has to be a positive number of OMR per metre.',
      });
    }
  }

  const override: Override | null =
    request.unitRate === undefined
      ? null
      : {
          unitRate: request.unitRate,
          reason,
          by: request.actor.name,
          at: request.at,
        };

  const choice: ProductChoice | null =
    request.product === undefined
      ? null
      : {
          productCode: request.product.code,
          sourceSheet: request.product.sourceSheet,
          reason,
          by: request.actor.name,
          at: request.at,
        };

  const parts = [
    choice === null ? null : `priced as ${choice.productCode}`,
    override === null ? null : `rate set to ${override.unitRate.toString()} OMR/m`,
  ].filter((p): p is string => p !== null);

  return ok({
    position: request.position,
    override,
    choice,
    summary: parts.join(', '),
  });
}

/** Where a job is in its life, for a screen that has to say so in words. */
export function statusLabel(status: JobStatus): string {
  switch (status) {
    case 'review':
      return 'In review';
    case 'approved':
      return 'Quoted';
    case 'abandoned':
      return 'Closed';
  }
}
