import { metres } from '@/core/units';
import { SOURCE_TERMS } from '@/infra/data';
import { repositories } from '@/infra/memory/repository';
import { NOW } from '@/infra/memory/seed';
import { computeCost } from '@/modules/costing';
import { DataTable } from '@/ui/components/DataTable';
import { NumericCell } from '@/ui/components/NumericCell';
import { Panel } from '@/ui/components/Panel';

export const metadata = { title: 'Catalogue — Cable Quoting' };

/**
 * Nuhas's own quoting terms, from the cost master's Drivers sheet: margin on
 * cost, nothing else. Drum, packing, and freight are not in the source data
 * and are not invented here.
 */
const TERMS = SOURCE_TERMS;

/**
 * Product Catalogue.
 *
 * Every costed product with its cost on today's copper. Each row is priced
 * through the same engine as everything else — there are no stored prices in
 * this app, so this table is always current by construction.
 */
export default async function CataloguePage() {
  const { products, rates } = repositories;
  const [list, rateSet] = await Promise.all([
    products.list(),
    rates.resolveAt(NOW),
  ]);

  const priced = list.map((product) => {
    const result = computeCost(product, { metres: metres(1000) }, rateSet, TERMS);
    return { product, result };
  });

  const families = [...new Set(list.map((p) => p.family))];

  return (
    <div style={{ padding: 24 }} className="flex flex-col gap-6">
      <header>
        <h1
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'var(--text-display-lg)',
            lineHeight: 'var(--text-display-lg--line-height)',
            letterSpacing: 'var(--text-display-lg--letter-spacing)',
            fontWeight: 500,
          }}
        >
          Catalogue
        </h1>
        <p className="mt-2" style={{ color: 'var(--color-ink-secondary)' }}>
          {list.length} costed products, priced on today&rsquo;s copper. Nothing
          here is a stored price — every figure is rebuilt from the rate tables
          on load.
        </p>

        {/* Filter chips. The active one is the only one with a copper underline. */}
        <div className="mt-4 flex flex-wrap gap-2">
          <Chip active>All</Chip>
          {families.map((f) => (
            <Chip key={f}>{f}</Chip>
          ))}
        </div>
      </header>

      <Panel title="Products" flush>
        <DataTable
          columns={[
            {
              key: 'designation',
              header: 'Designation',
              render: ({ product }) => (
                <span style={{ color: 'var(--color-ink-primary)' }}>
                  {product.designation}
                </span>
              ),
            },
            {
              key: 'id',
              header: 'Code',
              width: 200,
              render: ({ product }) => (
                <span
                  className="numeric"
                  style={{
                    color: 'var(--color-ink-secondary)',
                    fontSize: 'var(--text-micro)',
                    textAlign: 'left',
                    display: 'block',
                  }}
                >
                  {product.id}
                </span>
              ),
            },
            {
              key: 'cores',
              header: 'Cores',
              align: 'right',
              width: 70,
              render: ({ product }) => (
                <span className="numeric">{product.spec.cores}</span>
              ),
            },
            {
              key: 'size',
              header: 'Size',
              align: 'right',
              width: 90,
              render: ({ product }) => (
                <NumericCell value={product.spec.sizeMm2} decimals={1} unit="mm²" />
              ),
            },
            {
              key: 'costPerM',
              header: 'Cost / m',
              align: 'right',
              width: 120,
              render: ({ result }) =>
                result.ok ? (
                  <NumericCell value={result.value.costPerMetre} kind="costPerMetre" />
                ) : (
                  <NumericCell value={null} />
                ),
            },
            {
              key: 'rate',
              header: 'Unit rate',
              align: 'right',
              width: 120,
              render: ({ result }) =>
                result.ok ? (
                  <NumericCell
                    value={result.value.unitRate}
                    kind="unitRate"
                    weight="strong"
                  />
                ) : (
                  <NumericCell value={null} />
                ),
            },
            {
              key: 'status',
              header: 'Status',
              width: 190,
              // Match tiers describe an RFQ line against the library. Nothing is
              // being matched here — every row *is* a library product — so this
              // column states whether it could be priced, in its own words.
              render: ({ result }) =>
                result.ok ? (
                  <span style={{ color: 'var(--color-ink-secondary)' }}>Priced</span>
                ) : (
                  <span
                    className="flex items-baseline gap-2"
                    title={result.error.message}
                  >
                    <span
                      aria-hidden
                      className="inline-block shrink-0 rounded-full"
                      style={{
                        width: 6,
                        height: 6,
                        backgroundColor: 'var(--color-status-manual)',
                      }}
                    />
                    <span style={{ color: 'var(--color-status-manual)' }}>
                      Cannot price
                    </span>
                  </span>
                ),
            },
          ]}
          rows={priced}
          rowKey={({ product }) => product.id}
          href={({ product }) => `/catalogue/${product.id}`}
        />
      </Panel>
    </div>
  );
}

function Chip({
  children,
  active = false,
}: {
  readonly children: React.ReactNode;
  readonly active?: boolean;
}) {
  return (
    <span
      style={{
        padding: '4px 10px',
        borderRadius: 'var(--radius-sm)',
        color: active ? 'var(--color-ink-primary)' : 'var(--color-ink-secondary)',
        backgroundColor: 'var(--color-surface-panel)',
        border: '1px solid var(--color-line-hairline)',
        borderBottom: active
          ? '1px solid var(--color-copper)'
          : '1px solid var(--color-line-hairline)',
        fontSize: 'var(--text-body)',
      }}
    >
      {children}
    </span>
  );
}
