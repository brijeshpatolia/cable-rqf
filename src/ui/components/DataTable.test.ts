import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DataTable, type Column } from './DataTable';

/*
  Rendered through `react-dom/server` rather than a DOM, because the defect
  this guards against lives in the *string* the server sends. A browser hides
  it: the parser silently repairs invalid nesting, so by the time there is a
  DOM to query the evidence has been tidied away. The mismatch between the
  string and the repair is precisely what React reports as #418.

  `createElement` rather than JSX because the suite compiles `.ts`.
*/

interface Row {
  readonly id: string;
  readonly name: string;
}

const ROWS: readonly Row[] = [{ id: 'Q-1', name: 'One' }];

/** How many anchors open while another is still open. */
function nestedAnchors(html: string): number {
  let depth = 0;
  let nested = 0;
  for (const m of html.matchAll(/<(\/?)a\b[^>]*>/g)) {
    if (m[1] === '/') {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth > 0) nested += 1;
    depth += 1;
  }
  return nested;
}

describe('DataTable row links', () => {
  const plain: Column<Row> = {
    key: 'name',
    header: 'Name',
    render: (r) => r.name,
  };

  const withOwnLinks = (interactive: boolean): Column<Row> => ({
    key: 'export',
    header: 'Export',
    ...(interactive ? { interactive: true } : {}),
    render: (r) => createElement('a', { href: `/quotes/${r.id}/pdf` }, 'PDF'),
  });

  it('wraps an ordinary cell so the whole row is clickable', () => {
    const html = renderToStaticMarkup(
      createElement(DataTable<Row>, {
        columns: [plain],
        rows: ROWS,
        rowKey: (r) => r.id,
        href: (r) => `/quotes/${r.id}`,
      }),
    );
    expect(html).toContain('href="/quotes/Q-1"');
    expect(nestedAnchors(html)).toBe(0);
  });

  it('does not wrap a column that carries its own links', () => {
    const html = renderToStaticMarkup(
      createElement(DataTable<Row>, {
        columns: [plain, withOwnLinks(true)],
        rows: ROWS,
        rowKey: (r) => r.id,
        href: (r) => `/quotes/${r.id}`,
      }),
    );
    // Both links survive — the row's and the cell's — and neither is inside
    // the other.
    expect(html).toContain('href="/quotes/Q-1"');
    expect(html).toContain('href="/quotes/Q-1/pdf"');
    expect(nestedAnchors(html)).toBe(0);
  });

  it('would nest anchors without the opt-out, which is the defect', () => {
    /*
      The negative case, asserted rather than described. Without it the two
      tests above pass just as well against a `DataTable` that never wraps
      anything, and this file would be checking nothing.
    */
    const html = renderToStaticMarkup(
      createElement(DataTable<Row>, {
        columns: [plain, withOwnLinks(false)],
        rows: ROWS,
        rowKey: (r) => r.id,
        href: (r) => `/quotes/${r.id}`,
      }),
    );
    expect(nestedAnchors(html)).toBe(1);
  });

  it('leaves cells alone when the table has no row link', () => {
    const html = renderToStaticMarkup(
      createElement(DataTable<Row>, {
        columns: [plain, withOwnLinks(false)],
        rows: ROWS,
        rowKey: (r) => r.id,
      }),
    );
    expect(nestedAnchors(html)).toBe(0);
  });
});
