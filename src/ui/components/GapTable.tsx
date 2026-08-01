import { formatNumber } from '@/core/format';
import type { Gap, Gaps } from '@/modules/coverage';
import { DataTable } from './DataTable';

/**
 * What the library was asked for and could not price.
 *
 * The percentages above this table say how much fails. They cannot say what to
 * do about it, and the two things a team might do — widen the range, or build a
 * better reader — are answered by different rows. So every row states which
 * kind of failure it is, and the counts above the table state the split.
 *
 * Ranked by metres because that is what the customer wrote down. There are no
 * prices here and there cannot be: a line nothing could cost has no value, and
 * inventing one from its nearest match would be the app arguing for its own
 * roadmap with a number it has just said it cannot produce.
 */
export function GapTable({ gaps }: { readonly gaps: Gaps }) {
  if (gaps.rows.length === 0) {
    return (
      <div style={{ padding: 24, color: 'var(--color-ink-tertiary)', textAlign: 'center' }}>
        Every line in the window priced against the library. Nothing to add.
      </div>
    );
  }

  return (
    <DataTable<Gap>
      columns={[
        {
          key: 'label',
          header: 'Asked for',
          render: (g) => (
            <span className="flex flex-col" style={{ gap: 2, padding: '6px 0' }}>
              <span className="numeric" style={{ textAlign: 'left', display: 'block' }}>
                {g.label}
              </span>
              {/*
                The customer's own words underneath the app's reading of them.
                A row an engineer cannot recognise is a row nobody acts on, and
                the parsed spec alone reads like something the app made up.
              */}
              <span
                style={{
                  color: 'var(--color-ink-tertiary)',
                  fontSize: 'var(--text-micro)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  maxWidth: 460,
                }}
                title={g.example}
              >
                {g.example}
              </span>
            </span>
          ),
        },
        {
          key: 'kind',
          header: 'Why',
          width: 150,
          render: (g) =>
            g.kind === 'not-in-library' ? (
              <span
                style={{ color: 'var(--color-ink-secondary)' }}
                title="Read correctly. There is no such product in the library."
              >
                Not in the library
              </span>
            ) : (
              <span
                style={{ color: 'var(--color-status-manual)' }}
                title="The cores or the size could not be made out, so nothing could match it whatever the library holds."
              >
                Could not read it
              </span>
            ),
        },
        {
          key: 'lines',
          header: 'Lines',
          align: 'right',
          width: 70,
          render: (g) => <span className="numeric">{g.lines}</span>,
        },
        {
          key: 'customers',
          header: 'Customers',
          align: 'right',
          width: 95,
          render: (g) => (
            <span
              className="numeric"
              style={g.customers === 0 ? { color: 'var(--color-ink-disabled)' } : undefined}
              title="Distinct named customers who asked for this"
            >
              {g.customers === 0 ? '—' : g.customers}
            </span>
          ),
        },
        {
          key: 'metres',
          header: 'Metres',
          align: 'right',
          width: 130,
          render: (g) => (
            <span className="flex flex-col items-end" style={{ gap: 1 }}>
              <span className="numeric">{formatNumber(g.metres, 0)}</span>
              {/*
                Said out loud rather than folded in. A gap whose quantities
                could not be read would otherwise sit low in a ranking by
                metres and look unimportant, when the truth is that nobody
                knows how big it is.
              */}
              {g.withoutQuantity === 0 ? null : (
                <span
                  className="numeric"
                  style={{
                    fontSize: 'var(--text-mono-nano)',
                    color: 'var(--color-status-manual)',
                  }}
                  title="Lines here whose quantity could not be read, so they are not in this total"
                >
                  +{g.withoutQuantity} unknown
                </span>
              )}
            </span>
          ),
        },
      ]}
      rows={gaps.rows}
      rowKey={(g) => g.key}
      maxHeight={520}
    />
  );
}
