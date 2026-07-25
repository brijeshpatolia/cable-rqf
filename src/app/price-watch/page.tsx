import { formatDate, formatNumber } from '@/core/format';
import { repositories } from '@/infra/repositories';
import { now } from '@/infra/clock';
import {
  DEFAULT_THRESHOLD_PERCENT,
  driftHeadline,
  sweep,
  type DriftResult,
} from '@/modules/pricewatch';
import { DataTable } from '@/ui/components/DataTable';
import { NumericCell } from '@/ui/components/NumericCell';
import { Panel } from '@/ui/components/Panel';
import { StatusDot } from '@/ui/components/StatusDot';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Price Watch — Cable Quoting' };

/**
 * Live Price Watch.
 *
 * One place to see every live quote, what it was priced on, and when it
 * lapses. The exposure column is the only place in the app where a negative
 * number is coloured — it's a delta, not a cost.
 */
export default async function PriceWatchPage() {
  const asOf = now();
  const { quotes, rates } = repositories;
  const [open, rateSet] = await Promise.all([
    quotes.open(),
    rates.resolveAt(asOf),
  ]);

  const s = sweep(open, rateSet.copper.lme, asOf);
  const headline = driftHeadline(s);

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
          Price Watch
        </h1>

        {headline !== null ? (
          <p className="mt-3" style={{ color: 'var(--color-ink-primary)' }}>
            {headline.split(/(\d[\d,]*)/).map((part, i) =>
              /^\d/.test(part) ? (
                <span key={i} className="numeric">
                  {part}
                </span>
              ) : (
                part
              ),
            )}
          </p>
        ) : (
          <p className="mt-3" style={{ color: 'var(--color-ink-secondary)' }}>
            All open quotes are within {DEFAULT_THRESHOLD_PERCENT.toFixed(1)}% of
            the copper they were struck on.
          </p>
        )}
      </header>

      <Panel title="Exposure">
        <div className="flex flex-wrap items-baseline gap-x-10 gap-y-4">
          <Metric label="Open quotes" value={String(open.length)} />
          <Metric
            label="Flagged"
            value={String(s.breached.length)}
            alert={s.breached.length > 0}
          />
          <div className="flex flex-col gap-1">
            <span className="label">Total exposure</span>
            <NumericCell
              value={s.totalExposure}
              kind="total"
              unit="OMR"
              signed
              size="numeric-lg"
            />
          </div>
          <div className="flex flex-col gap-1">
            <span className="label">Copper now</span>
            <span
              className="numeric"
              style={{
                color: 'var(--color-copper)',
                fontSize: 'var(--text-display-sm)',
                textAlign: 'left',
                display: 'block',
              }}
            >
              {formatNumber(s.currentLme, 2)}
            </span>
          </div>
        </div>
      </Panel>

      <Panel title="Open quotes" flush>
        <DataTable
          columns={[
            {
              key: 'id',
              header: 'Quote',
              width: 140,
              render: (r: DriftResult) => (
                <span
                  className="numeric"
                  style={{ textAlign: 'left', display: 'block' }}
                >
                  {r.quote.quoteId}
                </span>
              ),
            },
            {
              key: 'customer',
              header: 'Customer',
              render: (r) => r.quote.customer,
            },
            {
              key: 'value',
              header: 'Value',
              align: 'right',
              width: 130,
              render: (r) => <NumericCell value={r.quote.value} kind="total" />,
            },
            {
              key: 'struck',
              header: 'Struck on',
              align: 'right',
              width: 110,
              render: (r) => <NumericCell value={r.quote.struckLme} kind="lme" />,
            },
            {
              key: 'move',
              header: 'Move',
              align: 'right',
              width: 100,
              render: (r) => (
                <NumericCell value={r.lmePercent} kind="percent" unit="%" signed />
              ),
            },
            {
              key: 'exposure',
              header: 'Exposure',
              align: 'right',
              width: 130,
              render: (r) => (
                <NumericCell value={r.exposure} kind="total" signed weight="strong" />
              ),
            },
            {
              key: 'expires',
              header: 'Expires',
              width: 120,
              render: (r) => (
                <span
                  className="numeric"
                  style={{
                    color: 'var(--color-ink-secondary)',
                    textAlign: 'left',
                    display: 'block',
                  }}
                >
                  {formatDate(r.quote.expiresAt)}
                </span>
              ),
            },
            {
              key: 'status',
              header: 'Status',
              width: 150,
              render: (r) =>
                r.status === 'lapsed' ? (
                  <span style={{ color: 'var(--color-ink-tertiary)' }}>Lapsed</span>
                ) : r.status === 'breached' ? (
                  <span className="flex items-baseline gap-2">
                    <StatusDot tier="close" withLabel={false} />
                    <span style={{ color: 'var(--color-status-review)' }}>
                      Repriced
                    </span>
                  </span>
                ) : (
                  <span className="flex items-baseline gap-2">
                    <StatusDot tier="exact" withLabel={false} />
                    <span style={{ color: 'var(--color-ink-secondary)' }}>
                      Within {DEFAULT_THRESHOLD_PERCENT.toFixed(1)}%
                    </span>
                  </span>
                ),
            },
          ]}
          rows={s.results}
          rowKey={(r) => r.quote.quoteId}
          empty="No open quotes."
        />
      </Panel>
    </div>
  );
}

function Metric({
  label,
  value,
  alert = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly alert?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="label">{label}</span>
      <span
        className="numeric"
        style={{
          fontSize: 'var(--text-display-sm)',
          color: alert ? 'var(--color-status-review)' : 'var(--color-ink-primary)',
          textAlign: 'left',
          display: 'block',
        }}
      >
        {value}
      </span>
    </div>
  );
}
