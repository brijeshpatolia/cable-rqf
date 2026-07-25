'use client';

import { useMemo, useState } from 'react';
import { dec } from '@/core/decimal';
import { formatDate } from '@/core/format';
import { DataTable, type Column } from './DataTable';
import { NumericCell } from './NumericCell';

/**
 * One rate row, flattened for the client boundary.
 *
 * `value` crosses as a string and becomes a `Decimal` again on arrival rather
 * than as pre-formatted text. Formatting is `NumericCell`'s job and nothing
 * else's — a number formatted upstream would escape the alignment and decimal
 * rules that make two rate columns comparable at a glance.
 */
export interface RateRowView {
  readonly rateId: string;
  readonly key: string;
  readonly description: string;
  readonly value: string;
  readonly validFrom: string;
  readonly validTo: string | null;
}

/**
 * The rate tables, searchable.
 *
 * The desk holds 168 rows and grows every time a code is added. Rendered flat,
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
          (history || r.validTo === null) &&
          (needle === '' ||
            r.key.toLowerCase().includes(needle) ||
            r.description.toLowerCase().includes(needle)),
      ),
    [rows, needle, history],
  );

  const superseded = rows.length - rows.filter((r) => r.validTo === null).length;

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
          {shown.length} of {rows.length}
        </span>
      </div>

      <DataTable
        columns={columns(unit)}
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

function columns(unit: string): readonly Column<RateRowView>[] {
  return [
    {
      key: 'key',
      header: 'Rate',
      render: (r) => (
        <span className="numeric" style={{ textAlign: 'left', display: 'block' }}>
          {r.key}
        </span>
      ),
    },
    {
      key: 'description',
      header: 'Description',
      // The code alone says nothing to anyone who has not memorised the
      // master. The description is what makes the row searchable by meaning.
      render: (r) => (
        <span style={{ color: 'var(--color-ink-secondary)' }}>{r.description}</span>
      ),
    },
    {
      key: 'value',
      header: unit,
      align: 'right',
      width: 110,
      render: (r) => <NumericCell value={dec(r.value)} kind="unitRate" />,
    },
    {
      key: 'from',
      header: 'Effective from',
      width: 130,
      render: (r) => (
        <span
          className="numeric"
          style={{
            color: 'var(--color-ink-secondary)',
            textAlign: 'left',
            display: 'block',
          }}
        >
          {formatDate(new Date(r.validFrom))}
        </span>
      ),
    },
    {
      key: 'to',
      header: 'Until',
      width: 130,
      render: (r) =>
        r.validTo === null ? (
          // Not a match tier, so it carries no status colour (DESIGN_SYSTEM.md rule 2).
          <span style={{ color: 'var(--color-ink-secondary)' }}>In force</span>
        ) : (
          <span
            className="numeric"
            style={{
              color: 'var(--color-ink-tertiary)',
              textAlign: 'left',
              display: 'block',
            }}
          >
            {formatDate(new Date(r.validTo))}
          </span>
        ),
    },
    {
      key: 'id',
      header: 'Row',
      align: 'right',
      width: 92,
      render: (r) => (
        <span
          className="numeric"
          style={{
            color: 'var(--color-ink-tertiary)',
            fontSize: 'var(--text-micro)',
          }}
        >
          {shortId(r.rateId)}
        </span>
      ),
    },
  ];
}

/**
 * Enough of the row's id to tie a rate to its audit entry, without a 36-
 * character uuid wrapping over four lines. The full value is one query away.
 */
function shortId(id: string): string {
  return id.length > 12 ? `#${id.slice(0, 8)}` : `#${id}`;
}
