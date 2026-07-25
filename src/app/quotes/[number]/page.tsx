import { notFound } from 'next/navigation';
import { formatDate, formatInstant, formatNumber } from '@/core/format';
import { now } from '@/infra/clock';
import { quoteStore } from '@/infra/repositories';
import { copperMassOf, isExpired, totalOf } from '@/modules/quoting';
import { CostBreakdownView } from '@/ui/components/CostBreakdownView';
import { ExpandableRow } from '@/ui/components/ExpandableRow';
import { NumericCell } from '@/ui/components/NumericCell';
import { Panel, Field } from '@/ui/components/Panel';
import { requireRead } from '../guard';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ number: string }>;
}) {
  const { number } = await params;
  return { title: `${number} — Cable Quoting` };
}

export default async function QuotePage({
  params,
}: {
  params: Promise<{ number: string }>;
}) {
  await requireRead();

  const { number } = await params;
  const asOf = now();
  const quote = await quoteStore.byNumber(number);
  if (quote === undefined) notFound();

  const lapsed = isExpired(quote, asOf);

  return (
    <div style={{ padding: 24 }} className="flex flex-col gap-6">
      <header className="flex items-start justify-between gap-8">
        <div>
          <a href="/quotes" style={{ color: 'var(--color-ink-tertiary)', fontSize: 'var(--text-micro)' }}>
            ← Quotes
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
            {quote.customer}
          </h1>
          <div className="mt-3 flex flex-wrap gap-x-8 gap-y-3">
            <Field label="Quote">
              <span className="numeric">{quote.number}</span>
            </Field>
            <Field label="Priced">
              <span className="numeric" style={{ fontSize: 'var(--text-micro)' }}>
                {formatInstant(quote.pricedAt)}
              </span>
            </Field>
            <Field label="Valid until">
              <span
                className="numeric"
                style={{
                  fontSize: 'var(--text-micro)',
                  color: lapsed ? 'var(--color-status-review)' : 'var(--color-ink-primary)',
                }}
              >
                {formatDate(quote.validUntil)}{lapsed ? ' — lapsed' : ''}
              </span>
            </Field>
            <Field label="Approved by">
              <span style={{ color: 'var(--color-ink-secondary)' }}>
                {quote.createdBy ?? '—'}
              </span>
            </Field>
          </div>
        </div>

        <div className="flex shrink-0 gap-2">
          <a href={`/quotes/${quote.number}/pdf`} style={exportButton}>PDF</a>
          <a href={`/quotes/${quote.number}/xlsx`} style={exportButton}>Excel</a>
        </div>
      </header>

      <div className="flex gap-6">
        <div className="min-w-0 flex-1">
          <Panel title="Lines" flush>
            <div
              className="label flex items-center gap-3"
              style={{ padding: '6px 12px', borderBottom: '1px solid var(--color-line-strong)' }}
            >
              <span style={{ width: 8 }} />
              <span className="flex-1">Description</span>
              <span style={{ width: 110, textAlign: 'right' }}>Quantity</span>
              <span style={{ width: 100, textAlign: 'right' }}>Unit rate</span>
              <span style={{ width: 130, textAlign: 'right' }}>Amount</span>
            </div>

            {quote.lines.map((line) => (
              <ExpandableRow
                key={line.position}
                summary={
                  <span className="flex items-center gap-3">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{line.designation}</span>
                      <span
                        className="numeric block"
                        style={{ color: 'var(--color-ink-tertiary)', fontSize: 'var(--text-micro)', textAlign: 'left' }}
                      >
                        {line.productCode}
                      </span>
                    </span>
                    <span style={{ width: 110, textAlign: 'right' }}>
                      <NumericCell value={line.quantityMetres} decimals={0} unit="m" />
                    </span>
                    <span style={{ width: 100, textAlign: 'right' }}>
                      <NumericCell value={line.unitRate} kind="unitRate" />
                    </span>
                    <span style={{ width: 130, textAlign: 'right' }}>
                      <NumericCell value={line.lineTotal} kind="total" weight="strong" />
                    </span>
                  </span>
                }
              >
                {/*
                  The frozen snapshot, not a recomputation. This is what the
                  price was actually built from on the day it was struck.
                */}
                <CostBreakdownView breakdown={line.breakdown} />
              </ExpandableRow>
            ))}
          </Panel>
        </div>

        <aside style={{ width: 300 }} className="shrink-0 flex flex-col gap-6">
          <Panel title="Total">
            <NumericCell
              value={totalOf(quote.lines)}
              kind="total"
              unit="OMR"
              weight="strong"
              size="numeric-lg"
            />
            <div className="mt-4 flex flex-col gap-3">
              <Field label="Lines">
                <span className="numeric">{quote.lines.length}</span>
              </Field>
              <Field label="Margin">
                <NumericCell value={quote.marginPercent} kind="percent" unit="%" />
              </Field>
            </div>
          </Panel>

          <Panel title="The strike">
            <div className="flex flex-col gap-3">
              <Field label="LME copper">
                <NumericCell value={quote.lmeStruck} kind="lme" unit="USD/t" />
              </Field>
              <Field label="FX">
                <NumericCell value={quote.fxStruck} kind="fx" unit="OMR/USD" />
              </Field>
              <Field label="Copper content">
                <NumericCell value={copperMassOf(quote.lines)} decimals={1} unit="kg" />
              </Field>
            </div>
            <p
              className="mt-3"
              style={{
                color: 'var(--color-ink-secondary)',
                fontSize: 'var(--text-micro)',
                lineHeight: 'var(--text-micro--line-height)',
              }}
            >
              This quote was struck on copper at {formatNumber(quote.lmeStruck, 2)}.
              Every figure above can be expanded to the rate row it came from.
            </p>
          </Panel>

          {quote.terms !== null && quote.terms !== '' ? (
            <Panel title="Terms">
              <p
                style={{
                  color: 'var(--color-ink-secondary)',
                  fontSize: 'var(--text-micro)',
                  lineHeight: 'var(--text-micro--line-height)',
                }}
              >
                {quote.terms}
              </p>
            </Panel>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

const exportButton: React.CSSProperties = {
  border: '1px solid var(--color-line-strong)',
  borderRadius: 'var(--radius-md)',
  color: 'var(--color-ink-primary)',
  padding: '7px 14px',
  fontSize: 'var(--text-body)',
  minHeight: 'var(--row-height)',
};
