import { describe, expect, it } from 'vitest';
import { GROUPS, activeHref } from './RailNav';

/*
  These cover the prefix rule, not the defect that prompted them.

  The rail's marker went stale on client-side navigation because the path came
  from a request header and the root layout is not re-rendered when only the
  page below it changes. `activeHref` was correct throughout — it was being
  handed a path from the wrong moment. Only a browser walking between pages
  proves that fix, and this file cannot.

  What it does protect is the matching, which is fiddly enough to break under
  an innocent edit: add a route whose href is a prefix of another and the wrong
  item lights up.
*/

describe('activeHref', () => {
  it('lights the page you are on', () => {
    expect(activeHref('/quotes')).toBe('/quotes');
    expect(activeHref('/rates')).toBe('/rates');
  });

  it('lights the parent of a detail page', () => {
    expect(activeHref('/quotes/Q-2026-0007')).toBe('/quotes');
    expect(activeHref('/catalogue/C07C02F2XLLWLKNA/design')).toBe('/catalogue');
  });

  it('keeps the Inbox exact, or it would own every path', () => {
    expect(activeHref('/')).toBe('/');
    expect(activeHref('/rates')).not.toBe('/');
  });

  it('lands a job screen on the Inbox, which is where it came from', () => {
    expect(activeHref('/jobs/J-2026-0031')).toBe('/');
  });

  it('lights nothing on a page the rail does not own', () => {
    expect(activeHref('/sign-in')).toBeNull();
    expect(activeHref(null)).toBeNull();
  });

  it('prefers the longest match, so a prefix cannot steal a page', () => {
    /*
      `/price-watch` and `/prices` would both be matched by a naive
      `startsWith`. The rule is longest-wins; this states it on the real
      route set rather than a hypothetical one.
    */
    const hrefs = GROUPS.flatMap((g) => g.items.map((i) => i.href));
    for (const href of hrefs) {
      expect(activeHref(href), href).toBe(href);
    }
  });
});
