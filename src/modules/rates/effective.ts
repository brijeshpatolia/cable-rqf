import type { Decimal } from '@/core/decimal';

/**
 * Effective dating.
 *
 * Every rate row carries a validity period. Resolution "as of" an instant is
 * how pricing today and reconstructing an eight-month-old quote become the
 * same code path — the caller just passes a different instant.
 *
 * In Postgres this is backed by an exclusion constraint so overlapping periods
 * for the same key cannot exist. `assertNoOverlap` below is the same rule,
 * enforced in the seam where rows are written, so an in-memory or imported
 * table can't drift from what the database would allow.
 */
export interface EffectiveRow<T> {
  readonly key: string;
  readonly value: T;
  readonly validFrom: Date;
  /** `null` means open-ended — the row currently in force. */
  readonly validTo: Date | null;
  readonly rateId: string;
  readonly table: string;
}

export function isInForce(row: EffectiveRow<unknown>, asOf: Date): boolean {
  if (row.validFrom.getTime() > asOf.getTime()) return false;
  if (row.validTo === null) return true;
  return row.validTo.getTime() > asOf.getTime();
}

/**
 * The row in force for a key at an instant, or `undefined`. Never guesses, and
 * never falls back to "the most recent row" — a gap in history is a real gap,
 * and the engine refuses to price rather than inventing a rate.
 */
export function resolveAt<T>(
  rows: readonly EffectiveRow<T>[],
  key: string,
  asOf: Date,
): EffectiveRow<T> | undefined {
  return rows.find((r) => r.key === key && isInForce(r, asOf));
}

/** Every key's in-force row at an instant, as a map — one pass, not one per key. */
export function resolveAllAt<T>(
  rows: readonly EffectiveRow<T>[],
  asOf: Date,
): Map<string, EffectiveRow<T>> {
  const out = new Map<string, EffectiveRow<T>>();
  for (const row of rows) {
    if (isInForce(row, asOf)) out.set(row.key, row);
  }
  return out;
}

export interface OverlapError {
  readonly key: string;
  readonly a: string;
  readonly b: string;
}

/**
 * The invariant the database enforces, checked wherever rows are written.
 * Two rows for the same key may not both be in force at any instant.
 */
export function findOverlaps<T>(
  rows: readonly EffectiveRow<T>[],
): readonly OverlapError[] {
  const byKey = new Map<string, EffectiveRow<T>[]>();
  for (const row of rows) {
    const list = byKey.get(row.key);
    if (list === undefined) byKey.set(row.key, [row]);
    else list.push(row);
  }

  const errors: OverlapError[] = [];
  for (const [key, list] of byKey) {
    const sorted = [...list].sort(
      (a, b) => a.validFrom.getTime() - b.validFrom.getTime(),
    );
    for (let i = 1; i < sorted.length; i += 1) {
      const prev = sorted[i - 1]!;
      const next = sorted[i]!;
      const prevEnd = prev.validTo?.getTime() ?? Infinity;
      if (prevEnd > next.validFrom.getTime()) {
        errors.push({ key, a: prev.rateId, b: next.rateId });
      }
    }
  }
  return errors;
}

/**
 * Superseding a rate closes the old row rather than updating it. History is
 * the product — nothing is ever overwritten (ARCHITECTURE.md rule 5).
 */
export function supersede<T>(
  rows: readonly EffectiveRow<T>[],
  key: string,
  value: T,
  at: Date,
  newRateId: string,
): readonly EffectiveRow<T>[] {
  const current = resolveAt(rows, key, at);
  const closed = rows.map((r) =>
    current !== undefined && r.rateId === current.rateId
      ? { ...r, validTo: at }
      : r,
  );

  const template = current ?? rows.find((r) => r.key === key);
  return [
    ...closed,
    {
      key,
      value,
      validFrom: at,
      validTo: null,
      rateId: newRateId,
      table: template?.table ?? 'rate',
    },
  ];
}

export type DecimalRow = EffectiveRow<Decimal>;
