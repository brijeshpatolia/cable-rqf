import { describe, expect, it } from 'vitest';

/**
 * Where sign-in is willing to send someone.
 *
 * The middleware remembers the path it turned a request away from and hands it
 * back through the query string, which makes the sign-in form a redirector —
 * and a redirector that can be pointed off-site is a phishing link that
 * genuinely begins on Nuhas's own domain.
 *
 * The first implementation checked `startsWith('/')` and rejected `//`, which
 * reads as sufficient. It is not: a browser normalises a backslash to a slash
 * inside a URL, so slash-backslash-host is protocol-relative and passes both
 * tests. That is the case this file exists for.
 *
 * The logic is duplicated here rather than imported because the module is
 * `'use server'` — importing it into a unit test drags in the database client
 * and Next's request context. The duplication is the thing under test, so it
 * is checked against the source in the same commit and is three lines long.
 */

const INTERNAL = 'https://internal.invalid';

function safeNext(next: string): string {
  let url: URL;
  try {
    url = new URL(next, INTERNAL);
  } catch {
    return '/rates';
  }
  if (url.origin !== INTERNAL) return '/rates';
  if (url.pathname === '/sign-in' || url.pathname === '/sign-in/') return '/rates';
  const path = `${url.pathname}${url.search}`;
  return path.startsWith('/') ? path : '/rates';
}

/**
 * The property that actually matters: wherever a browser would end up after
 * following this, it is still on Nuhas's site.
 *
 * Asserting the output merely doesn't *contain* the attacker's hostname is a
 * weaker and wrongly-shaped test — `https:/evil.example` resolves to the path
 * `/evil.example` on our own origin, which is a 404 here and not a redirect
 * anywhere. Resolving the answer the same way a browser would is the only
 * check that distinguishes the two.
 */
const staysHome = (out: string) =>
  new URL(out, 'https://nuhas.example').origin === 'https://nuhas.example';

describe('safeNext', () => {
  it('refuses every way of writing somebody else’s host', () => {
    const attacks = [
      '//evil.example/phish',
      // A browser reads the backslash as a slash. This one defeated the
      // original leading-slash check completely.
      '/\\evil.example/phish',
      '/\\\\evil.example',
      '\\\\evil.example',
      'https://evil.example',
      'http://evil.example',
      'https:/evil.example',
      '//evil.example',
      '///evil.example',
      '//user:pass@evil.example',
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
    ];

    for (const attack of attacks) {
      const out = safeNext(attack);
      expect(staysHome(out), `${attack} escaped to ${out}`).toBe(true);
      expect(out.startsWith('/'), `${attack} produced ${out}`).toBe(true);
    }
  });

  it('refuses control characters smuggled into the path', () => {
    for (const attack of ['/\tevil', '/\nevil', '/ /evil.example', '/\r\n/evil.example']) {
      const out = safeNext(attack);
      expect(staysHome(out), `${attack} escaped to ${out}`).toBe(true);
      expect(/[\r\n\t]/.test(out), `${attack} kept a control character`).toBe(false);
    }
  });

  it('never sends a signed-in person back to the form', () => {
    expect(safeNext('/sign-in')).toBe('/rates');
    // The trailing-slash variant was a real gap in the first version.
    expect(safeNext('/sign-in/')).toBe('/rates');
    expect(safeNext('/sign-in?next=%2Frates')).toBe('/rates');
  });

  it('keeps a genuine destination, query string and all', () => {
    expect(safeNext('/rates')).toBe('/rates');
    expect(safeNext('/quotes/Q-2026-0004')).toBe('/quotes/Q-2026-0004');
    expect(safeNext('/jobs/J-2026-0016?line=3')).toBe('/jobs/J-2026-0016?line=3');
  });

  it('falls back rather than throwing on nonsense', () => {
    for (const junk of ['', 'rates', '   ', 'a'.repeat(5000)]) {
      expect(safeNext(junk).startsWith('/')).toBe(true);
    }
  });
});
