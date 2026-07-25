'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { DataTable, type Column } from './DataTable';

/**
 * One rate row, ready to display.
 *
 * `cells` arrive already rendered by the server. That is deliberate: number
 * formatting is `NumericCell`'s job and nothing else's, and `NumericCell`
 * takes a `Decimal`. Sending the raw values here instead would drag decimal.js
 * into the browser — 14 kB of arbitrary-precision arithmetic shipped so a
 * search box can hide rows. The fields above `cells` are the ones this
 * component actually needs: what to match on, and what to key by.
 */
export interface RateRowView {
  readonly rateId: string;
  readonly key: string;
  readonly description: string;
  readonly inForce: boolean;
  readonly cells: readonly ReactNode[];
}

/** Headers and widths, in the order `cells` supplies them. */
const COLUMNS: readonly { readonly header: string; readonly width?: number }[] = [
  { header: 'Rate' },
  { header: 'Description' },
  { header: '', width: 110 },
  { header: 'Effective from', width: 130 },
  { header: 'Until', width: 130 },
  { header: 'Row', width: 92 },
];

/** The unit column, whose header is the only one that varies. */
const UNIT_COLUMN = 2;

/**
 * The rate tables, searchable.
 *
 * The desk holds 167 rows and grows every time a code is added. Rendered flat,
 * finding `CC2RF07` meant scrolling several thousand pixels past rows that
 * were never in question, and the superseded history of every code sat between
 * the ones actually in force.
 *
 * So: history is folded away by default, and there is a box to type a code
 * into. Filtering happens here rather than on the server because the answer is
 * already in the browser — a round trip to hide rows the page is holding would
 * be slower and no more correct.
 */
export function RateTable({
  rows,
  unit,
}: {
  readonly rows: readonly RateRowView[];
  readonly unit: string;
}) {
  const [query, setQuery] = useState('');
  const [history, setHistory] = useState(false);

  const needle = query.trim().toLowerCase();

  const shown = useMemo(
    () =>
      rows.filter(
        (r) =>
          (history || r.inForce) &&
          (needle === '' ||
            r.key.toLowerCase().includes(needle) ||
            r.description.toLowerCase().includes(needle)),
      ),
    [rows, needle, history],
  );

  const columns = useMemo<readonly Column<RateRowView>[]>(
    () =>
      COLUMNS.map((c, i) => ({
        key: String(i),
        header: i === UNIT_COLUMN ? unit : c.header,
        ...(i === UNIT_COLUMN || i === COLUMNS.length - 1
          ? { align: 'right' as const }
          : {}),
        ...(c.width === undefined ? {} : { width: c.width }),
        render: (r: RateRowView) => r.cells[i],
      })),
    [unit],
  );

  const superseded = rows.length - rows.filter((r) => r.inForce).length;

  return (
    <div>
      <div
        className="flex flex-wrap items-center gap-3"
        style={{
          padding: '8px var(--cell-pad-x)',
          borderBottom: '1px solid var(--color-line-hairline)',
        }}
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find a code or description"
          aria-label="Find a rate"
          style={{
            backgroundColor: 'var(--color-surface-base)',
            border: '1px solid var(--color-line-strong)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--color-ink-primary)',
            padding: '5px 8px',
            fontSize: 'var(--text-body)',
            minHeight: 'var(--row-height)',
            flex: 1,
            minWidth: 180,
          }}
        />

        {superseded === 0 ? null : (
          <label
            className="flex items-center gap-2"
            style={{
              color: 'var(--color-ink-secondary)',
              fontSize: 'var(--text-micro)',
              whiteSpace: 'nowrap',
            }}
          >
            <input
              type="checkbox"
              checked={history}
              onChange={(e) => setHistory(e.target.checked)}
            />
            Show superseded ({superseded})
          </label>
        )}

        <span
          className="numeric"
          style={{
            color: 'var(--color-ink-tertiary)',
            fontSize: 'var(--text-micro)',
            whiteSpace: 'nowrap',
          }}
        >
          {shown.length} of {history ? rows.length : rows.length - superseded}
        </span>
      </div>

      <DataTable
        columns={columns}
        rows={shown}
        rowKey={(r) => r.rateId}
        // Bounded so the desk stays one screen however many codes the master
        // grows to. Adding a code should not push the copper driver below the
        // fold for everyone.
        maxHeight={520}
        empty={
          needle === ''
            ? 'No rates here.'
            : `Nothing matches “${query.trim()}”. The code may not be in the master yet.`
        }
      />
    </div>
  );
}
