import type { Decimal } from '@/core/decimal';
import { ABSENT, format, formatNumber, type PrecisionKey } from '@/core/format';

interface NumericCellProps {
  /**
   * A Decimal, or `null` for *no value exists*. There is deliberately no
   * string variant — a pre-formatted number would escape the rules below.
   */
  readonly value: Decimal | null | undefined;
  /** Semantic kind, so a rate looks like a rate on every screen. */
  readonly kind?: PrecisionKey;
  /** Explicit decimals, when the column isn't one of the standard kinds. */
  readonly decimals?: number;
  /** Trails the digit block in tertiary ink, outside the aligned column. */
  readonly unit?: string;
  /** Emphasis for a subtotal or total line. */
  readonly weight?: 'normal' | 'strong';
  /**
   * Delta columns only (price-watch drift). Negatives are red *here* and
   * nowhere else — never in a cost column.
   */
  readonly signed?: boolean;
  readonly size?: 'numeric' | 'numeric-lg' | 'micro';
}

/**
 * Owns every number-formatting rule in DESIGN_SYSTEM.md §3.
 *
 * Fixed decimals with trailing zeros kept, thousands separated, units outside
 * the digit block so they never disturb decimal alignment, `0.000` for zero
 * and `—` for absence.
 */
export function NumericCell({
  value,
  kind,
  decimals,
  unit,
  weight = 'normal',
  signed = false,
  size = 'numeric',
}: NumericCellProps) {
  const text =
    decimals !== undefined
      ? formatNumber(value, decimals)
      : kind !== undefined
        ? format(value, kind)
        : formatNumber(value, 2);

  const absent = text === ABSENT;
  const negative = signed && !absent && text.startsWith('-');

  const color = absent
    ? 'var(--color-ink-tertiary)'
    : negative
      ? 'var(--color-status-manual)'
      : 'var(--color-ink-primary)';

  const display =
    signed && !absent && !negative && !text.startsWith('0') ? `+${text}` : text;

  return (
    <span className="inline-flex items-baseline justify-end gap-1.5 tabular-nums">
      <span
        className="numeric"
        style={{
          color,
          fontSize: `var(--text-${size})`,
          lineHeight: `var(--text-${size}--line-height)`,
          fontWeight: weight === 'strong' ? 500 : 420,
        }}
      >
        {display}
      </span>
      {unit ? (
        <span
          style={{
            color: 'var(--color-ink-tertiary)',
            fontSize: 'var(--text-micro)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          {unit}
        </span>
      ) : null}
    </span>
  );
}
