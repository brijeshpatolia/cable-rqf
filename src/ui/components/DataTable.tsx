import type { ReactNode } from 'react';

export interface Column<T> {
  readonly key: string;
  readonly header: string;
  readonly align?: 'left' | 'right';
  /** Reserved so a data refresh causes no layout shift. */
  readonly width?: number;
  readonly render: (row: T) => ReactNode;
}

interface DataTableProps<T> {
  readonly columns: readonly Column<T>[];
  readonly rows: readonly T[];
  readonly rowKey: (row: T) => string;
  readonly href?: (row: T) => string;
  readonly empty?: string;
  /**
   * Scroll the rows inside the panel past this height, instead of letting the
   * page grow with the row count. The header stays put, because it is sticky
   * to whichever box scrolls.
   */
  readonly maxHeight?: number;
  /**
   * `dense` — 32px rows, the default, and what every list of records uses.
   * `shell` — 44px rows on the inset header surface, for the two screens the
   * 2026 redesign covers.
   *
   * Two scales rather than one because the argument for each is real and they
   * disagree. The Rate Desk shows 167 rows and the Catalogue 99: a third fewer
   * rows per screen is a cost paid by whoever is reading them. The Inbox is a
   * worklist of a dozen enquiries where a row is a thing you act on, and the
   * extra height is what makes the Match column and the two-line Quoted cell
   * legible. Opt in per screen, never globally.
   */
  readonly scale?: 'dense' | 'shell';
  /** Rendered under the last row, inside the same scroll box. */
  readonly footer?: ReactNode;
}

/**
 * The table.
 *
 * Sticky header, rows separated by hairlines, column widths reserved so a
 * refresh never shifts the layout. Virtualisation is added when a table first
 * exceeds ~200 rows — the markup here is already the shape TanStack Virtual
 * expects.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  href,
  empty = 'Nothing here.',
  maxHeight,
  scale = 'dense',
  footer,
}: DataTableProps<T>) {
  const shell = scale === 'shell';
  const padX = shell ? 'var(--cell-pad-x-shell)' : 'var(--cell-pad-x)';
  const rowHeight = shell ? 'var(--row-height-shell)' : 'var(--row-height)';
  if (rows.length === 0) {
    return (
      <>
        <div
          style={{
            padding: 24,
            color: 'var(--color-ink-tertiary)',
            textAlign: 'center',
          }}
        >
          {empty}
        </div>
        {footer}
      </>
    );
  }

  return (
    <div
      style={{
        overflowX: 'auto',
        ...(maxHeight === undefined ? {} : { maxHeight, overflowY: 'auto' }),
      }}
    >
      <table className="w-full" style={{ borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                className="label"
                style={{
                  textAlign: c.align ?? 'left',
                  padding: shell ? `9px ${'var(--cell-pad-x-shell)'}` : 'var(--cell-pad-y) var(--cell-pad-x)',
                  borderBottom: `1px solid var(${shell ? '--color-line-panel' : '--color-line-strong'})`,
                  backgroundColor: `var(${shell ? '--color-surface-inset' : '--color-surface-panel'})`,
                  position: 'sticky',
                  top: 0,
                  width: c.width,
                  fontWeight: 560,
                }}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const link = href?.(row);
            return (
              <tr
                key={rowKey(row)}
                className={shell && link !== undefined ? 'row-hover' : undefined}
                style={{
                  borderBottom: '1px solid var(--color-line-hairline)',
                  ...(shell && link !== undefined ? { cursor: 'pointer' } : {}),
                }}
              >
                {columns.map((c, i) => (
                  <td
                    key={c.key}
                    style={{
                      textAlign: c.align ?? 'left',
                      padding: shell ? `0 ${'var(--cell-pad-x-shell)'}` : 'var(--cell-pad-y) var(--cell-pad-x)',
                      height: rowHeight,
                      width: c.width,
                    }}
                  >
                    {/*
                      The anchor stays on the first cell even when the whole
                      row is clickable: middle-click, right-click and "copy
                      link address" all need a real href, and a row-level
                      onClick gives none of them.
                    */}
                    {link !== undefined && i === 0 ? (
                      <a href={link} style={{ color: 'inherit' }}>
                        {c.render(row)}
                      </a>
                    ) : (
                      c.render(row)
                    )}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      {footer}
    </div>
  );
}
