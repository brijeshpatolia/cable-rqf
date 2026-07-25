import type { Decimal } from '@/core/decimal';
import { type Result, err, ok } from '@/core/result';
import type { Actor } from '@/modules/auth';
import type { EffectiveRow } from './effective';

/**
 * Rate editing — the decision, separated from the writing.
 *
 * Superseding a rate is two facts and an invariant: the row in force stops
 * being in force at an instant, and a new row starts at exactly that instant.
 * This module decides whether that is legitimate and what the two rows must
 * look like; `infra/db` performs it in one transaction.
 *
 * Keeping the decision pure means the rule is testable in microseconds and
 * cannot drift from what the database will accept — the plan it produces is
 * shaped precisely to satisfy the EXCLUDE constraint.
 */

export type RateKind = 'material' | 'machine';

export interface SupersedeRequest {
  readonly kind: RateKind;
  readonly code: string;
  readonly newValue: Decimal;
  /** Only meaningful for LME-linked material codes. */
  readonly newDrawingPremium?: Decimal;
  readonly at: Date;
  readonly reason: string;
  readonly actor: Actor;
}

export interface SupersedePlan {
  readonly kind: RateKind;
  readonly code: string;
  /** The row to close, and the instant to close it at. */
  readonly close: { readonly rateId: string; readonly validTo: Date };
  /** The row to open, starting exactly where the old one ended. */
  readonly open: {
    readonly value: Decimal;
    readonly drawingPremium: Decimal | null;
    readonly validFrom: Date;
  };
  /** What the audit row must say. Written in the same transaction. */
  readonly audit: {
    readonly actorId: string;
    readonly actorEmail: string;
    readonly entity: string;
    readonly field: string;
    readonly previous: string;
    readonly next: string;
    readonly reason: string;
  };
}

export type EditErrorCode =
  | 'UNKNOWN_CODE'
  | 'NOT_IN_FORCE'
  | 'NOT_LATER'
  | 'NO_CHANGE'
  | 'NEGATIVE'
  | 'REASON_REQUIRED'
  | 'PREMIUM_MISMATCH';

export interface EditError {
  readonly code: EditErrorCode;
  readonly message: string;
}

const fail = (code: EditErrorCode, message: string): EditError => ({ code, message });

export interface CurrentRate {
  readonly row: EffectiveRow<Decimal>;
  readonly lmeLinked: boolean;
  readonly drawingPremium: Decimal | null;
}

/**
 * Decides whether a rate change is legitimate, and what it becomes.
 *
 * Every refusal names the reason in words the engineer can act on. None of
 * these are stylistic: each one corresponds to something the database would
 * otherwise reject with a constraint violation, and a stated reason beats a
 * SQLSTATE every time.
 */
export function planSupersede(
  request: SupersedeRequest,
  current: CurrentRate | undefined,
): Result<SupersedePlan, EditError> {
  if (current === undefined) {
    return err(
      fail(
        'UNKNOWN_CODE',
        `${request.code} is not a rate this system holds. Nothing was changed.`,
      ),
    );
  }

  if (current.row.validTo !== null) {
    return err(
      fail(
        'NOT_IN_FORCE',
        `The ${request.code} row being superseded is already closed. ` +
          'Reload the rate desk — someone else has changed it.',
      ),
    );
  }

  if (request.reason.trim() === '') {
    return err(
      fail(
        'REASON_REQUIRED',
        'A rate change needs a reason. It is the part of the audit trail a ' +
          'person reads eight months later.',
      ),
    );
  }

  // The new period starts exactly where the old one ends, so the two are
  // adjacent rather than overlapping. Starting at or before the old row's
  // start would make the period backwards or the two rows concurrent.
  if (request.at.getTime() <= current.row.validFrom.getTime()) {
    return err(
      fail(
        'NOT_LATER',
        `A new ${request.code} rate must take effect after the one it replaces, ` +
          `which has been in force since ${current.row.validFrom.toISOString()}.`,
      ),
    );
  }

  if (request.newValue.isNegative()) {
    return err(fail('NEGATIVE', 'A rate cannot be negative.'));
  }

  const premium = request.newDrawingPremium ?? null;

  // An LME-linked code prices off copper plus its own drawing premium; a fixed
  // code has no premium at all. Mismatching the two would be accepted by the
  // types and rejected by a CHECK constraint, so it is caught here with an
  // explanation instead.
  if (current.lmeLinked && premium === null) {
    return err(
      fail(
        'PREMIUM_MISMATCH',
        `${request.code} prices off the LME, so it needs a drawing premium.`,
      ),
    );
  }
  if (!current.lmeLinked && premium !== null) {
    return err(
      fail(
        'PREMIUM_MISMATCH',
        `${request.code} holds a fixed rate, so a drawing premium would do nothing.`,
      ),
    );
  }
  if (premium !== null && premium.isNegative()) {
    return err(fail('NEGATIVE', 'A drawing premium cannot be negative.'));
  }

  const valueUnchanged = request.newValue.equals(current.row.value);
  const premiumUnchanged =
    (premium === null && current.drawingPremium === null) ||
    (premium !== null &&
      current.drawingPremium !== null &&
      premium.equals(current.drawingPremium));

  if (valueUnchanged && premiumUnchanged) {
    return err(
      fail(
        'NO_CHANGE',
        `${request.code} already holds that value. Nothing was written.`,
      ),
    );
  }

  // The audit records what actually moved. For an LME-linked code that is the
  // premium, since the rate itself is derived from copper and is not stored.
  const field = current.lmeLinked && !premiumUnchanged ? 'drawing_premium' : 'rate';
  const previous =
    field === 'drawing_premium'
      ? (current.drawingPremium?.toString() ?? '—')
      : current.row.value.toString();
  const next =
    field === 'drawing_premium'
      ? (premium?.toString() ?? '—')
      : request.newValue.toString();

  return ok({
    kind: request.kind,
    code: request.code,
    close: { rateId: current.row.rateId, validTo: request.at },
    open: {
      value: request.newValue,
      drawingPremium: premium,
      validFrom: request.at,
    },
    audit: {
      actorId: request.actor.id,
      actorEmail: request.actor.email,
      entity: `${current.row.table}:${request.code}`,
      field,
      previous,
      next,
      reason: request.reason.trim(),
    },
  });
}

/**
 * A new copper tick.
 *
 * Not a supersede: the LME series is append-only, because a tick is a fact
 * about a moment. A wrong one is corrected by entering a later one, so the
 * quote struck on the original can still be reconstructed exactly.
 */
export interface LmeEntryRequest {
  readonly at: Date;
  readonly lme: Decimal;
  readonly fx: Decimal;
  readonly actor: Actor;
}

export interface LmeEntryPlan {
  readonly at: Date;
  readonly lme: Decimal;
  readonly fx: Decimal;
  readonly enteredBy: string;
  readonly audit: SupersedePlan['audit'];
}

export function planLmeEntry(
  request: LmeEntryRequest,
  latest: { readonly at: Date; readonly lme: Decimal } | undefined,
): Result<LmeEntryPlan, EditError> {
  if (!request.lme.greaterThan(0) || !request.fx.greaterThan(0)) {
    return err(
      fail('NEGATIVE', 'A copper price and an FX rate must both be above zero.'),
    );
  }

  if (latest !== undefined && request.at.getTime() <= latest.at.getTime()) {
    return err(
      fail(
        'NOT_LATER',
        `The most recent copper price is dated ${latest.at.toISOString()}. ` +
          'A new one must be later — the series is a record of moments, not a value to edit.',
      ),
    );
  }

  return ok({
    at: request.at,
    lme: request.lme,
    fx: request.fx,
    enteredBy: request.actor.name,
    audit: {
      actorId: request.actor.id,
      actorEmail: request.actor.email,
      entity: 'lme_price',
      field: 'lme',
      previous: latest?.lme.toString() ?? '—',
      next: request.lme.toString(),
      reason: 'Copper price entered',
    },
  });
}
