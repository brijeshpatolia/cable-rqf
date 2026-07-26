'use client';

import { useMemo, useState } from 'react';
import type { EntityKind } from '@/modules/audit';

export interface HistoryRow {
  readonly id: string;
  readonly kind: EntityKind;
  /** `Material rate` */
  readonly label: string;
  /** `ABPT025`, or empty for a singleton like the copper price. */
  readonly name: string;
  /** Where to go to see the thing itself. Null when it has no screen. */
  readonly href: string | null;
  /** The subject was deleted; its history remains. Shown, not hidden. */
  readonly gone: boolean;
  readonly what: string;
  readonly from: string;
  readonly to: string;
  readonly reason: string | null;
  readonly actor: string;
  readonly at: string;
  /** Everything searchable about the row, folded once on the server. */
  readonly haystack: string;
}

const KIND_LABELS: Readonly<Record<EntityKind, string>> = {
  material: 'Material rates',
  machine: 'Machine rates',
  copper: 'Copper',
  product: 'Products',
  job: 'Enquiries',
  quote: 'Quotes',
  substitution: 'Substitutions',
  vocabulary: 'Dictionary',
  account: 'Accounts',
  other: 'Other',
};

/**
 * The trail, filtered.
 *
 * Filtering happens here rather than on the server because the answer is
 * already in the browser — the page holds the rows it is showing, and a round
 * trip to hide some of them would be slower and no more correct.
 *
 * Both controls narrow together and say what they left: an engineer who filters
 * to Quotes and finds nothing needs to know whether that means *no quote ever
 * changed* or *no quote changed in the rows on this page*.
 */
export function HistoryTable({
  rows,
  kinds,
  total,
}: {
  readonly rows: readonly HistoryRow[];
  readonly kinds: readonly EntityKind[];
  /** How many rows exist in all, so the page can say what it is not showing. */
  readonly total: number;
}) {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<EntityKind | null>(null);

  const needle = query.trim().toLowerCase();

  const shown = useMemo(
    () =>
      rows.filter(
        (r) =>
          (kind === null || r.kind === kind) &&
          (needle === '' || r.haystack.includes(needle)),
      ),
    [rows, kind, needle],
  );

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
          placeholder="Find a code, a job, a person, a reason"
          aria-label="Find a change"
          style={input}
        />
        <span className="numeric" style={counter}>
          {shown.length} of {rows.length}
          {rows.length < total ? ` · ${total} in all` : ''}
        </span>
      </div>

      <div
        className="flex flex-wrap gap-2"
        style={{
          padding: '8px var(--cell-pad-x)',
          borderBottom: '1px solid var(--color-line-strong)',
        }}
      >
        <Chip active={kind === null} onClick={() => setKind(null)}>
          Everything
        </Chip>
        {kinds.map((k) => (
          <Chip key={k} active={kind === k} onClick={() => setKind(kind === k ? null : k)}>
            {KIND_LABELS[k]}
          </Chip>
        ))}
      </div>

      {shown.length === 0 ? (
        <p style={{ ...note, padding: 24, textAlign: 'center' }}>
          {rows.length === 0
            ? 'Nothing has been changed yet.'
            : `Nothing here matches. ${
                rows.length < total
                  ? `This page holds the most recent ${rows.length} of ${total} changes — an older one may be further back.`
                  : 'The whole trail is on this page, so it did not happen.'
              }`}
        </p>
      ) : (
        <div className="flex flex-col">
          {shown.map((r) => (
            <div
              key={r.id}
              className="flex gap-4"
              style={{
                padding: '8px var(--cell-pad-x)',
                borderBottom: '1px solid var(--color-line-hairline)',
              }}
            >
              <span
                className="numeric shrink-0"
                style={{ width: 150, color: 'var(--color-ink-tertiary)', fontSize: 'var(--text-micro)' }}
              >
                {r.at}
              </span>

              <span className="shrink-0" style={{ width: 180 }}>
                <span style={{ color: 'var(--color-ink-tertiary)', fontSize: 'var(--text-micro)' }}>
                  {r.label}
                </span>
                <br />
                {r.href === null ? (
                  <span
                    className="numeric"
                    style={{ textAlign: 'left', display: 'block' }}
                    // Deliberately not a status colour: a deleted subject is
                    // not a problem with the row, it is the reason the row is
                    // worth keeping.
                    title={r.gone ? 'No longer in the app. Its history stays.' : undefined}
                  >
                    {r.name}
                    {r.gone ? (
                      <span
                        style={{
                          color: 'var(--color-ink-tertiary)',
                          fontSize: 'var(--text-micro)',
                        }}
                      >
                        {' '}
                        · deleted
                      </span>
                    ) : null}
                  </span>
                ) : (
                  <a
                    href={r.href}
                    className="numeric"
                    style={{ color: 'var(--color-copper)', textAlign: 'left', display: 'block' }}
                  >
                    {r.name}
                  </a>
                )}
              </span>

              <span className="min-w-0 flex-1">
                <span style={{ color: 'var(--color-ink-primary)' }}>{r.what}</span>{' '}
                <span className="numeric" style={{ color: 'var(--color-ink-secondary)' }}>
                  {r.from} → {r.to}
                </span>
                {r.reason === null ? null : (
                  <div style={{ ...note, marginTop: 2 }}>{r.reason}</div>
                )}
              </span>

              <span
                className="shrink-0"
                style={{ width: 140, color: 'var(--color-ink-tertiary)', fontSize: 'var(--text-micro)' }}
              >
                {r.actor}
              </span>
            </div>
          ))}
        </div>
      )}
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
      onClick={onClick}
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
    </button>
  );
}

const input: React.CSSProperties = {
  backgroundColor: 'var(--color-surface-base)',
  border: '1px solid var(--color-line-strong)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--color-ink-primary)',
  padding: '5px 8px',
  fontSize: 'var(--text-body)',
  minHeight: 'var(--row-height)',
  flex: 1,
  minWidth: 220,
};

const counter: React.CSSProperties = {
  color: 'var(--color-ink-tertiary)',
  fontSize: 'var(--text-micro)',
  whiteSpace: 'nowrap',
};

const note: React.CSSProperties = {
  color: 'var(--color-ink-secondary)',
  fontSize: 'var(--text-micro)',
  lineHeight: 'var(--text-micro--line-height)',
  maxWidth: 680,
};
