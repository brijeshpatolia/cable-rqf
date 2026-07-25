import { notFound } from 'next/navigation';
import { dec } from '@/core/decimal';
import { metres } from '@/core/units';
import { SOURCE_TERMS } from '@/infra/data';
import { repositories } from '@/infra/repositories';
import { now } from '@/infra/clock';
import { copperMetalValue } from '@/modules/costing';
import { computeCost } from '@/modules/costing';
import { CopperBlock } from '@/ui/components/CopperBlock';
import { CostBreakdownView } from '@/ui/components/CostBreakdownView';
import { NumericCell } from '@/ui/components/NumericCell';
import { Panel, Field } from '@/ui/components/Panel';
import { TierLegend } from '@/ui/components/StatusDot';

/**
 * Nuhas's own quoting terms, from the cost master's Drivers sheet: margin on
 * cost, nothing else. Drum, packing, and freight are not in the source data
 * and are not invented here.
 */
const TERMS = SOURCE_TERMS;

/**
 * Product Detail — the Phase 1 signature screen.
 *
 * Everything is server-rendered from one `computeCost` call, so the breakdown
 * ships with the row and expansion has no loading state.
 */
export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const asOf = now();
  const { id } = await params;
  const { products, rates } = repositories;

  const [product, rateSet] = await Promise.all([
    products.byId(id),
    rates.resolveAt(asOf),
  ]);

  if (product === undefined) notFound();

  const quantity = { metres: metres(12000) };
  const result = computeCost(product, quantity, rateSet, TERMS);
  const copperRate = copperMetalValue(rateSet.copper);

  return (
    <div style={{ padding: 24 }} className="flex flex-col gap-6">
      <header className="flex items-start justify-between gap-8">
        <div>
          <a
            href="/catalogue"
            style={{
              color: 'var(--color-ink-tertiary)',
              fontSize: 'var(--text-micro)',
            }}
          >
            ← Catalogue
          </a>
          <a
            href={`/catalogue/${id}/design`}
            style={{
              marginLeft: 16,
              color: 'var(--color-copper)',
              fontSize: 'var(--text-micro)',
            }}
          >
            Design and bill of materials →
          </a>
          <h1
            className="mt-2"
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 'var(--text-display-lg)',
              lineHeight: 'var(--text-display-lg--line-height)',
              letterSpacing: 'var(--text-display-lg--letter-spacing)',
              fontWeight: 500,
            }}
          >
            {product.designation}
          </h1>
          <div className="mt-3 flex flex-wrap gap-x-8 gap-y-3">
            <Field label="Product">
              <span className="numeric" style={{ fontSize: 'var(--text-numeric)' }}>
                {product.id}
              </span>
            </Field>
            <Field label="Cores">
              <NumericCell value={dec(product.spec.cores)} decimals={0} />
            </Field>
            <Field label="Size">
              <NumericCell value={product.spec.sizeMm2} decimals={1} unit="mm²" />
            </Field>
            <Field label="Family">
              <span style={{ color: 'var(--color-ink-secondary)' }}>
                {product.family}
              </span>
            </Field>
          </div>
        </div>

        <div style={{ width: 260 }} className="shrink-0">
          <CopperBlock
            copper={rateSet.copper}
            derivedOmrPerKg={copperRate}
            asOf={asOf}
          />
        </div>
      </header>

      {!result.ok ? (
        <Panel title="Cannot be priced">
          <p style={{ color: 'var(--color-status-manual)' }}>
            {result.error.message}
          </p>
          <p
            className="mt-2"
            style={{
              color: 'var(--color-ink-tertiary)',
              fontSize: 'var(--text-micro)',
            }}
          >
            The app refuses to price rather than guess. A line marked
            &ldquo;engineer to price&rdquo; costs twenty minutes; a wrong price
            costs the margin on the whole order.
          </p>
        </Panel>
      ) : (
        <div className="flex gap-6">
          <div className="min-w-0 flex-1">
            <Panel title="Cost build-up" flush>
              <CostBreakdownView breakdown={result.value} />
            </Panel>
          </div>

          <aside style={{ width: 300 }} className="shrink-0 flex flex-col gap-6">
            <Panel title="This line">
              <div className="flex flex-col gap-4">
                <Field label="Quantity">
                  <NumericCell value={result.value.quantity} decimals={0} unit="m" />
                </Field>
                <Field label="Unit rate">
                  <NumericCell
                    value={result.value.unitRate}
                    kind="unitRate"
                    unit="OMR/m"
                    weight="strong"
                  />
                </Field>
                <div
                  style={{
                    borderTop: '1px solid var(--color-line-strong)',
                    paddingTop: 12,
                  }}
                >
                  <Field label="Line total">
                    <NumericCell
                      value={result.value.lineTotal}
                      kind="total"
                      unit="OMR"
                      weight="strong"
                      size="numeric-lg"
                    />
                  </Field>
                </div>
              </div>

              {/* The one primary action on this screen. */}
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
                  <NumericCell
                    value={result.value.copperMassPerKm}
                    kind="weight"
                    unit="kg/km"
                  />
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
      )}
    </div>
  );
}
