import { COPPER_FORMULA_CONFIRMED } from '@/modules/costing';
import type { CopperRate } from '@/modules/costing';
import { formatInstant, formatNumber } from '@/core/format';
import { NumericCell } from './NumericCell';

/**
 * The app's one coloured element.
 *
 * Copper appears here and on the single primary action of a screen. Nowhere
 * else. It means "this is the number that moves" — using it sparingly is what
 * makes it read as premium rather than busy.
 */
export function CopperBlock({
  copper,
  derivedOmrPerKg,
  asOf,
}: {
  readonly copper: CopperRate;
  readonly derivedOmrPerKg: import('@/core/decimal').Decimal;
  readonly asOf: Date;
}) {
  return (
    <div
      style={{
        padding: 16,
        border: '1px solid var(--color-line-hairline)',
        borderRadius: 'var(--radius-lg)',
        backgroundColor: 'var(--color-surface-panel)',
      }}
    >
      <div className="label">LME Copper</div>

      <div className="mt-1 flex items-baseline gap-2">
        <span
          className="numeric copper-tick"
          style={{
            color: 'var(--color-copper)',
            fontSize: 'var(--text-numeric-lg)',
            lineHeight: 'var(--text-numeric-lg--line-height)',
          }}
        >
          {formatNumber(copper.lme, 2)}
        </span>
        <span
          style={{
            color: 'var(--color-ink-tertiary)',
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-micro)',
          }}
        >
          USD/t
        </span>
      </div>

      <div
        className="mt-3 grid gap-y-1"
        style={{ gridTemplateColumns: 'auto 1fr' }}
      >
        <span className="label self-baseline">FX</span>
        <NumericCell value={copper.fx} kind="fx" unit="OMR/USD" />
        <span className="label self-baseline">Copper</span>
        <NumericCell value={derivedOmrPerKg} decimals={4} unit="OMR/kg" />
      </div>

      <div
        className="mt-3"
        style={{
          color: 'var(--color-ink-tertiary)',
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--text-micro)',
        }}
      >
        {formatInstant(asOf)}
      </div>

      {!COPPER_FORMULA_CONFIRMED ? (
        <div
          className="mt-3"
          style={{
            borderTop: '1px solid var(--color-line-hairline)',
            paddingTop: 8,
            color: 'var(--color-status-review)',
            fontSize: 'var(--text-micro)',
            lineHeight: 'var(--text-micro--line-height)',
          }}
        >
          Formula assumed: LME × FX ÷ 1000 + drawing premium. Pending
          confirmation by the rate owner.
        </div>
      ) : null}
    </div>
  );
}
