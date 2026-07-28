'use client';

import { useMemo, useRef, useState, type ReactNode } from 'react';
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
  { key: null, label: 'All' },
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
 * Where a key press moves the selection in a radiogroup, or `null` if the key
 * is not one this control handles.
 *
 * A radiogroup takes one tab stop and the arrows move within it. That is not
 * decoration: the roving `tabIndex` that buys the single tab stop is exactly
 * what makes the other three segments unreachable without this, because they
 * carry `tabIndex={-1}`. Half the pattern is worse than neither half — an ARIA
 * role does not bring the native keyboard behaviour with it.
 *
 * Pulled out as a pure function because the arithmetic — wrapping at both
 * ends, Home and End, which keys count — is the part that can be wrong, and
 * testing it needs no DOM. Moving focus afterwards is glue.
 */
export function nextRadioIndex(key: string, at: number, count: number): number | null {
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return (at + 1) % count;
    case 'ArrowLeft':
    case 'ArrowUp':
      return (at - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

/**
 * The inbox, filterable.
 *
 * **Status is a segmented control, not chips.** The three states are mutually
 * exclusive and cover the list between them, which is exactly what a segmented
 * control says and exactly what a row of independent chips does not — three
 * chips invite you to try selecting two and then do nothing when you do. `All`
 * is a real segment rather than the absence of a selection, so the control is
 * never in a state that has no visible answer.
 *
 * Age stays a set of toggles, because those *are* independent of status and
 * clicking the active one clears it.
 *
 * Customers come from the rows rather than a fixed list: an inbox with two
 * customers in it should not offer forty. The 2026 handoff moves these into a
 * `⌘K` palette — they stay here until that palette exists, because moving a
 * working filter into something unbuilt is not a redesign, it is a deletion.
 *
 * All three narrow together and the count says what is left, so filtering to
 * nothing reads as *nothing matches these* rather than as an empty inbox.
 */
export function JobsTable({
  rows,
  columns,
}: {
  readonly rows: readonly JobRowView[];
  /** Headers and widths; the cells themselves arrive already rendered. */
  readonly columns: readonly {
    readonly header: string;
    readonly width?: number;
    readonly align?: 'left' | 'right';
  }[];
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

  const statusGroup = useRef<HTMLDivElement>(null);

  const clear = () => {
    setStatus(null);
    setCustomer(null);
    setDays(null);
    /*
      The Clear button unmounts on this state change — it only renders while
      something is filtered. Without moving focus deliberately it falls back to
      <body>, and a keyboard user has to tab in from the top of the document
      to get back to where they were.
    */
    statusGroup.current?.querySelector<HTMLButtonElement>('button')?.focus();
  };

  /**
   * Arrow keys move the selection, as a radiogroup must. Focus follows it,
   * because the segment that is checked is the one that carries the tab stop.
   */
  const onStatusKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const at = STATUSES.findIndex((s) => s.key === status);
    const to = nextRadioIndex(e.key, at, STATUSES.length);
    if (to === null) return;
    e.preventDefault();
    setStatus(STATUSES[to]!.key);
    statusGroup.current?.querySelectorAll('button')[to]?.focus();
  };

  return (
    <div>
      <div
        className="flex flex-wrap items-center"
        style={{
          padding: '12px var(--cell-pad-x-shell)',
          borderBottom: '1px solid var(--color-line-panel)',
          gap: 10,
        }}
      >
        {/*
          A radiogroup, not a group of toggles. The four states are mutually
          exclusive and cover the list between them, and `aria-pressed` says
          the opposite — a screen reader hears four independent toggles with
          no indication that choosing one clears the others. The roving
          tabIndex is the other half: without it the bar costs four tab stops
          to make one choice.
        */}
        <div
          ref={statusGroup}
          role="radiogroup"
          aria-label="Filter by status"
          onKeyDown={onStatusKeyDown}
          className="flex items-center"
          style={{
            padding: 2,
            gap: 2,
            backgroundColor: 'var(--color-surface-base)',
            border: '1px solid var(--color-line-panel)',
            borderRadius: 9,
          }}
        >
          {STATUSES.map((s) => {
            const selected = status === s.key;
            return (
              <button
                key={s.label}
                type="button"
                role="radio"
                aria-checked={selected}
                tabIndex={selected ? 0 : -1}
                onClick={() => setStatus(s.key)}
                style={{
                  height: 28,
                  padding: '0 12px',
                  borderRadius: 'var(--radius-control)',
                  fontSize: 12,
                  color: selected ? 'var(--color-ink-primary)' : 'var(--color-ink-secondary)',
                  backgroundColor: selected ? 'var(--color-surface-active)' : 'transparent',
                }}
              >
                {s.label}
              </button>
            );
          })}
        </div>

        <div className="flex items-center" style={{ gap: 6 }}>
          {AGES.map((a) => (
            <Chip
              key={a.key}
              active={days === a.key}
              onClick={() => setDays(days === a.key ? null : a.key)}
            >
              {a.label}
            </Chip>
          ))}
        </div>

        {customers.length < 2 ? null : (
          <div className="flex flex-wrap items-center" style={{ gap: 6 }}>
            {customers.map((c) => (
              <Chip
                key={c}
                active={customer === c}
                onClick={() => setCustomer(customer === c ? null : c)}
              >
                {c}
              </Chip>
            ))}
          </div>
        )}

        <div className="flex items-center ml-auto" style={{ gap: 12 }}>
          {/* Only rendered when there is something to clear — a permanently
              visible Clear is a control that does nothing most of the time. */}
          {filtered ? (
            <button
              type="button"
              onClick={clear}
              style={{ fontSize: 11.5, color: 'var(--color-ink-secondary)' }}
            >
              Clear filters
            </button>
          ) : null}
          <span
            className="numeric"
            style={{
              color: 'var(--color-ink-tertiary)',
              fontSize: 11,
              whiteSpace: 'nowrap',
            }}
          >
            {shown.length} / {rows.length}
          </span>
        </div>
      </div>

      <DataTable
        scale="shell"
        columns={cols}
        rows={shown}
        rowKey={(r) => r.reference}
        href={(r) => r.href}
        empty={
          filtered
            ? 'No enquiry matches these filters. Clear one to widen it.'
            : 'No enquiries yet. Paste one above, or upload the customer’s file.'
        }
      />
    </div>
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
      aria-pressed={active}
      onClick={onClick}
      style={{
        height: 28,
        padding: '0 11px',
        borderRadius: 'var(--radius-control)',
        fontSize: 12,
        color: active ? 'var(--color-ink-primary)' : 'var(--color-ink-secondary)',
        // Copper marks the active filter and nothing else in this bar. A
        // filled chip would read as a status, and the three status colours
        // are spent on match tiers.
        border: `1px solid var(${active ? '--color-copper' : '--color-line-panel'})`,
        backgroundColor: active ? 'var(--color-copper-wash)' : 'transparent',
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
