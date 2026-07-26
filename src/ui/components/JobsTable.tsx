'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { DataTable, type Column } from './DataTable';

export interface JobRowView {
  readonly reference: string;
  readonly href: string;
  readonly customer: string | null;
  readonly status: 'review' | 'approved' | 'abandoned';
  /** Days since it arrived, computed on the server so the client has no clock. */
  readonly ageDays: number;
  /** Rendered on the server, so no formatting rule lives twice. */
  readonly cells: readonly ReactNode[];
}

const STATUSES = [
  { key: 'review', label: 'In review' },
  { key: 'approved', label: 'Quoted' },
  { key: 'abandoned', label: 'Closed' },
] as const;

const AGES = [
  { key: 7, label: 'Last 7 days' },
  { key: 30, label: 'Last 30 days' },
  { key: 90, label: 'Last 90 days' },
] as const;

/**
 * The inbox, filterable.
 *
 * PROJECT_PLAN.md asks for status, customer and date range "as muted chips" —
 * muted because a filter is a way of looking at the list, not a status of
 * anything in it. Only the active one takes the copper underline, the same
 * treatment the catalogue's family chips already use.
 *
 * Customers come from the rows rather than a fixed list: an inbox with two
 * customers in it should not offer forty, and a customer who has never sent an
 * enquiry is not something to filter by.
 *
 * All three narrow together and the count says what is left, so filtering to
 * nothing reads as *nothing matches these three* rather than as an empty inbox.
 */
export function JobsTable({
  rows,
  columns,
}: {
  readonly rows: readonly JobRowView[];
  /** Headers and widths; the cells themselves arrive already rendered. */
  readonly columns: readonly { readonly header: string; readonly width?: number; readonly align?: 'left' | 'right' }[];
}) {
  const [status, setStatus] = useState<JobRowView['status'] | null>(null);
  const [customer, setCustomer] = useState<string | null>(null);
  const [days, setDays] = useState<number | null>(null);

  const customers = useMemo(
    () =>
      [...new Set(rows.map((r) => r.customer).filter((c): c is string => c !== null))]
        .sort((a, b) => a.localeCompare(b))
        .slice(0, 12),
    [rows],
  );

  const shown = useMemo(
    () =>
      rows.filter(
        (r) =>
          (status === null || r.status === status) &&
          (customer === null || r.customer === customer) &&
          (days === null || r.ageDays <= days),
      ),
    [rows, status, customer, days],
  );

  const cols = useMemo<readonly Column<JobRowView>[]>(
    () =>
      columns.map((c, i) => ({
        key: String(i),
        header: c.header,
        ...(c.width === undefined ? {} : { width: c.width }),
        ...(c.align === undefined ? {} : { align: c.align }),
        render: (r: JobRowView) => r.cells[i],
      })),
    [columns],
  );

  const filtered = status !== null || customer !== null || days !== null;

  return (
    <div>
      <div
        className="flex flex-wrap items-center gap-2"
        style={{
          padding: '8px var(--cell-pad-x)',
          borderBottom: '1px solid var(--color-line-strong)',
        }}
      >
        {STATUSES.map((s) => (
          <Chip
            key={s.key}
            active={status === s.key}
            onClick={() => setStatus(status === s.key ? null : s.key)}
          >
            {s.label}
          </Chip>
        ))}

        <Divider />

        {AGES.map((a) => (
          <Chip
            key={a.key}
            active={days === a.key}
            onClick={() => setDays(days === a.key ? null : a.key)}
          >
            {a.label}
          </Chip>
        ))}

        {customers.length < 2 ? null : (
          <>
            <Divider />
            {customers.map((c) => (
              <Chip
                key={c}
                active={customer === c}
                onClick={() => setCustomer(customer === c ? null : c)}
              >
                {c}
              </Chip>
            ))}
          </>
        )}

        <span
          className="numeric ml-auto"
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
        columns={cols}
        rows={shown}
        rowKey={(r) => r.reference}
        href={(r) => r.href}
        empty={
          filtered
            ? 'No enquiry matches all three filters. Clear one to widen it.'
            : 'No enquiries yet. Paste one above, or upload the customer’s file.'
        }
      />
    </div>
  );
}

function Divider() {
  return (
    <span
      aria-hidden
      style={{
        width: 1,
        height: 16,
        backgroundColor: 'var(--color-line-hairline)',
        margin: '0 2px',
      }}
    />
  );
}

function Chip({
  children,
  active,
  onClick,
}: {
  readonly children: React.ReactNode;
  readonly active: boolean;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '3px 10px',
        borderRadius: 'var(--radius-sm)',
        color: active ? 'var(--color-ink-primary)' : 'var(--color-ink-secondary)',
        backgroundColor: 'var(--color-surface-panel)',
        border: '1px solid var(--color-line-hairline)',
        // The only mark an active chip carries. A filled chip would read as a
        // status, and this app spends its three status colours elsewhere.
        borderBottom: active
          ? '1px solid var(--color-copper)'
          : '1px solid var(--color-line-hairline)',
        fontSize: 'var(--text-micro)',
        maxWidth: 200,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </button>
  );
}
