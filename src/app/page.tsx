import { dec } from '@/core/decimal';
import { metres } from '@/core/units';
import { computeCost } from '@/modules/costing/engine';
import { copperRatePerKg } from '@/modules/costing/copper';
import {
  SAMPLE_AS_OF,
  SAMPLE_PRODUCT,
  SAMPLE_RATES,
  SAMPLE_TERMS,
} from '@/modules/catalogue/sample';
import { CopperBlock } from '@/ui/components/CopperBlock';
import { CostBreakdownView } from '@/ui/components/CostBreakdownView';
import { NumericCell } from '@/ui/components/NumericCell';
import { Panel, Field } from '@/ui/components/Panel';
import { TierLegend } from '@/ui/components/StatusDot';

/**
 * Product Detail — the Phase 1 signature screen.
 *
 * Everything here is server-rendered from one `computeCost` call, so the
 * breakdown ships with the row and expansion has no loading state.
 */
export default function ProductDetailPage() {
  const quantity = { metres: metres(12000) };
  const result = computeCost(SAMPLE_PRODUCT, quantity, SAMPLE_RATES, SAMPLE_TERMS);
  const copperRate = copperRatePerKg(SAMPLE_RATES.copper, '50');

  if (!result.ok) {
    return (
      <div style={{ padding: 24 }}>
        <Panel title="Cannot be priced">
          <p style={{ color: 'var(--color-status-manual)' }}>
            {result.error.message}
          </p>
        </Panel>
      </div>
    );
  }

  const b = result.value;

  return (
    <div style={{ padding: 24 }} className="flex flex-col gap-6">
      <header className="flex items-start justify-between gap-8">
        <div>
          <h1
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 'var(--text-display-lg)',
              lineHeight: 'var(--text-display-lg--line-height)',
              letterSpacing: 'var(--text-display-lg--letter-spacing)',
              fontWeight: 500,
            }}
          >
            {b.designation}
          </h1>
          <div className="mt-3 flex flex-wrap gap-x-8 gap-y-3">
            <Field label="Product">
              <span className="numeric" style={{ fontSize: 'var(--text-numeric)' }}>
                {b.productId}
              </span>
            </Field>
            <Field label="Cores">
              <NumericCell value={dec(SAMPLE_PRODUCT.cores)} decimals={0} />
            </Field>
            <Field label="Size">
              <NumericCell value={SAMPLE_PRODUCT.sizeMm2} decimals={0} unit="mm²" />
            </Field>
            <Field label="Family">
              <span style={{ color: 'var(--color-ink-secondary)' }}>
                {SAMPLE_PRODUCT.family}
              </span>
            </Field>
          </div>
        </div>

        <div style={{ width: 260 }} className="shrink-0">
          <CopperBlock
            copper={SAMPLE_RATES.copper}
            derivedOmrPerKg={copperRate.ok ? copperRate.value : b.strike.copperOmrPerKg}
            asOf={SAMPLE_AS_OF}
          />
        </div>
      </header>

      <div className="flex gap-6">
        <div className="min-w-0 flex-1">
          <Panel title="Cost build-up" flush>
            <CostBreakdownView breakdown={b} />
          </Panel>
        </div>

        <aside style={{ width: 300 }} className="shrink-0 flex flex-col gap-6">
          <Panel title="This line">
            <div className="flex flex-col gap-4">
              <Field label="Quantity">
                <NumericCell value={b.quantity} decimals={0} unit="m" />
              </Field>
              <Field label="Unit rate">
                <NumericCell value={b.unitRate} kind="unitRate" unit="OMR/m" weight="strong" />
              </Field>
              <div
                style={{
                  borderTop: '1px solid var(--color-line-strong)',
                  paddingTop: 12,
                }}
              >
                <Field label="Line total">
                  <NumericCell
                    value={b.lineTotal}
                    kind="total"
                    unit="OMR"
                    weight="strong"
                    size="numeric-lg"
                  />
                </Field>
              </div>
            </div>

            {/* The one primary action on this screen — the only copper button. */}
            <button
              type="button"
              className="mt-5 w-full transition-colors"
              style={{
                backgroundColor: 'var(--color-copper)',
                color: 'var(--color-ink-on-copper)',
                borderRadius: 'var(--radius-md)',
                padding: '8px 12px',
                fontWeight: 550,
                minHeight: 'var(--row-height)',
              }}
            >
              Add to quote
            </button>
          </Panel>

          <Panel title="Copper exposure">
            <div className="flex flex-col gap-4">
              <Field label="Copper mass">
                <NumericCell value={b.copperMassPerKm} kind="weight" unit="kg/km" />
              </Field>
              <p
                style={{
                  color: 'var(--color-ink-secondary)',
                  fontSize: 'var(--text-micro)',
                  lineHeight: 'var(--text-micro--line-height)',
                }}
              >
                Price watch flags this quote when copper moves past the set
                threshold before it expires.
              </p>
            </div>
          </Panel>

          <Panel title="Match tiers">
            <TierLegend />
          </Panel>
        </aside>
      </div>
    </div>
  );
}
