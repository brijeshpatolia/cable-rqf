/**
 * The cost engine is *total*: it never throws. An input it cannot cost comes
 * back as an error with a stated reason, which the UI shows in words.
 *
 * This is the type-level form of the spec's central rule — if it isn't
 * confident, it doesn't price.
 */
export type Result<T, E = CostError> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

export type CostErrorCode =
  | 'MISSING_RATE'
  | 'MISSING_BOM'
  | 'UNKNOWN_MATERIAL'
  | 'UNKNOWN_MACHINE'
  | 'NO_MARGIN_RULE'
  | 'IMPLAUSIBLE_VALUE';

export interface CostError {
  readonly code: CostErrorCode;
  /** Shown to the engineer verbatim. Written as a fact, not an apology. */
  readonly message: string;
  /** What could not be resolved — a material key, a machine id, a product code. */
  readonly subject?: string;
}

export function costError(
  code: CostErrorCode,
  message: string,
  subject?: string,
): CostError {
  return subject === undefined ? { code, message } : { code, message, subject };
}

/** Collect a list of Results into a Result of list, failing on the first error. */
export function all<T, E>(results: readonly Result<T, E>[]): Result<T[], E> {
  const values: T[] = [];
  for (const r of results) {
    if (!r.ok) return r;
    values.push(r.value);
  }
  return ok(values);
}
