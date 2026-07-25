import DecimalJS from 'decimal.js';

/**
 * The arithmetic spine.
 *
 * Precision is 28 significant digits internally — far beyond what any cable
 * costing needs — because the rule is *no intermediate rounding*. Rounding
 * happens once, at the display and document boundary, in `format.ts`.
 *
 * ROUND_HALF_UP is stated in the UI footnote of every breakdown, so the
 * engineer knows how the last digit was decided.
 */
const Decimal = DecimalJS.clone({
  precision: 28,
  rounding: DecimalJS.ROUND_HALF_UP,
  toExpNeg: -9e15,
  toExpPos: 9e15,
});

export type Decimal = InstanceType<typeof Decimal>;
export { Decimal };

/** The only sanctioned way to turn external input into a Decimal. */
export function dec(value: string | number | Decimal): Decimal {
  return new Decimal(value);
}

export const ZERO: Decimal = new Decimal(0);
export const ONE: Decimal = new Decimal(1);
export const HUNDRED: Decimal = new Decimal(100);

/** Sum with an explicit zero identity, so an empty list is 0 and never NaN. */
export function sum(values: readonly Decimal[]): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(v), ZERO);
}

/** `base` increased by `percent` percent. Scrap allowances and margin both use this. */
export function addPercent(base: Decimal, percent: Decimal): Decimal {
  return base.times(HUNDRED.plus(percent)).dividedBy(HUNDRED);
}
