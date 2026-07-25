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
}

/**
 * The dense table.
 *
 * Sticky header on the panel surface with a strong underline; rows separated
 * by hairlines. Column widths are reserved, so a refresh never shifts the
 * layout. Virtualisation is added when a table first exceeds ~200 rows — the
 * markup here is already the shape TanStack Virtual expects.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  href,
  empty = 'Nothing here.',
  maxHeight,
}: DataTableProps<T>) {
  if (rows.length === 0) {
    return (
      <div
        style={{
          padding: 24,
          color: 'var(--color-ink-tertiary)',
          textAlign: 'center',
        }}
      >
        {empty}
      </div>
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
                  padding: 'var(--cell-pad-y) var(--cell-pad-x)',
                  borderBottom: '1px solid var(--color-line-strong)',
                  backgroundColor: 'var(--color-surface-panel)',
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
                style={{ borderBottom: '1px solid var(--color-line-hairline)' }}
              >
                {columns.map((c, i) => (
                  <td
                    key={c.key}
                    style={{
                      textAlign: c.align ?? 'left',
                      padding: 'var(--cell-pad-y) var(--cell-pad-x)',
                      height: 'var(--row-height)',
                      width: c.width,
                    }}
                  >
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
    </div>
  );
}
