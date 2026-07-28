import { formatDate, formatNumber } from '@/core/format';
import { now } from '@/infra/clock';
import { quoteStore } from '@/infra/repositories';
import { isExpired, totalOf, type Quote } from '@/modules/quoting';
import { DataTable } from '@/ui/components/DataTable';
import { NumericCell } from '@/ui/components/NumericCell';
import { Panel } from '@/ui/components/Panel';
import { requireRead } from './guard';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Quotes — Cable Quoting' };

export default async function QuotesPage() {
  await requireRead();

  const asOf = now();
  const quotes = await quoteStore.list();

  /*
    The footer used to add up every row.

    A correction does not replace its predecessor in this list — both rows
    stay, which is the point: the superseded quote is what a customer was
    actually told and it has to remain readable. But summing both counted the
    same enquiry twice, so correcting a 40,000 OMR quote by 200 OMR made the
    book jump by 40,200. The number people read off this line is "what have we
    got out there", and a replaced quote is not out there.

    Lapsed quotes are still counted. A quote past its validity date is a price
    that was offered and expired, not one that was withdrawn, and dropping it
    would quietly rewrite the quarter every time a date passed.
  */
  const standing = quotes.filter((q) => q.supersededBy === null);
  const replaced = quotes.length - standing.length;

  return (
    <div className="flex flex-col gap-6">
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
          Quotes
        </h1>
        <p className="mt-2" style={{ color: 'var(--color-ink-secondary)', maxWidth: 620 }}>
          Every quote, with the copper it was struck on and the date it lapses.
          Each carries its complete cost build-up, so a price can still be
          explained months after it was sent.
        </p>
      </header>

      <Panel title="All quotes" flush>
        <DataTable
          columns={[
            {
              key: 'number',
              header: 'Quote',
              width: 130,
              render: (q: Quote) => (
                <span className="numeric" style={{ textAlign: 'left', display: 'block' }}>
                  {q.number}
                </span>
              ),
            },
            { key: 'customer', header: 'Customer', render: (q) => q.customer },
            {
              key: 'lines',
              header: 'Lines',
              align: 'right',
              width: 70,
              render: (q) => <span className="numeric">{q.lines.length}</span>,
            },
            {
              key: 'value',
              header: 'Value',
              align: 'right',
              width: 130,
              render: (q) => <NumericCell value={totalOf(q.lines)} kind="total" weight="strong" />,
            },
            {
              key: 'struck',
              header: 'Struck on',
              align: 'right',
              width: 110,
              render: (q) => <NumericCell value={q.lmeStruck} kind="lme" />,
            },
            {
              key: 'expires',
              header: 'Valid until',
              width: 120,
              render: (q) => (
                <span
                  className="numeric"
                  style={{
                    color: isExpired(q, asOf)
                      ? 'var(--color-ink-tertiary)'
                      : 'var(--color-ink-secondary)',
                    textAlign: 'left',
                    display: 'block',
                  }}
                >
                  {formatDate(q.validUntil)}
                </span>
              ),
            },
            {
              key: 'status',
              header: 'Status',
              width: 110,
              /*
                Superseded is checked first, and it has to be.

                The row's own `status` column still reads `approved` after a
                correction is issued — that is deliberate, because the quote
                *was* approved and the document that went out says so. But this
                screen was rendering it as plain "Approved", identical to the
                quote standing in its place, so the list showed two live prices
                for one enquiry and nothing to say which one holds.

                It outranks Lapsed too. A quote that was replaced and then ran
                past its validity date was never going to be honoured on the
                strength of its date; what matters is that something else took
                its place.
              */
              render: (q) =>
                q.supersededBy !== null ? (
                  <span
                    style={{ color: 'var(--color-ink-tertiary)' }}
                    title={`Replaced by ${q.supersededBy}. That is the price that stands.`}
                  >
                    Replaced
                  </span>
                ) : isExpired(q, asOf) ? (
                  <span style={{ color: 'var(--color-ink-tertiary)' }}>Lapsed</span>
                ) : (
                  <span style={{ color: 'var(--color-ink-secondary)' }}>
                    {q.status[0]!.toUpperCase() + q.status.slice(1)}
                  </span>
                ),
            },
            {
              key: 'export',
              header: 'Export',
              width: 110,
              // Its own two links, so the row link must not wrap it. Nesting
              // one anchor in another is a parse error, and the tree the
              // browser builds then differs from the one the server sent.
              interactive: true,
              render: (q) => (
                <span className="flex gap-3">
                  <a href={`/quotes/${q.number}/pdf`} style={link}>PDF</a>
                  <a href={`/quotes/${q.number}/xlsx`} style={link}>Excel</a>
                </span>
              ),
            },
          ]}
          rows={quotes}
          rowKey={(q) => q.id}
          href={(q) => `/quotes/${q.number}`}
          empty="No quotes yet. Approve a job on the Review screen to create one."
        />
      </Panel>

      {quotes.length > 0 ? (
        <p style={{ color: 'var(--color-ink-tertiary)', fontSize: 'var(--text-micro)' }}>
          {quotes.length} quote{quotes.length === 1 ? '' : 's'} ·{' '}
          {formatNumber(totalOf(standing.flatMap((q) => q.lines)), 2)} OMR standing
          {replaced === 0
            ? ''
            : `, ${replaced} replaced quote${replaced === 1 ? '' : 's'} not counted`}
        </p>
      ) : null}
    </div>
  );
}

const link: React.CSSProperties = {
  color: 'var(--color-copper)',
  fontSize: 'var(--text-micro)',
};
