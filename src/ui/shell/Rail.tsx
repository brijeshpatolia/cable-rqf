import { roleLabel, type Actor } from '@/modules/auth';
import { WhoAmI } from '@/ui/components/WhoAmI';

/**
 * The left rail.
 *
 * Three changes from the version this replaces, all of them about answering
 * "where am I" — a question the old rail could not answer at all.
 *
 * **Grouped.** Eight flat links in one list made the app read as eight equal
 * things. They are not: Work is what an engineer does all day, Library is what
 * the Rate Owner curates, Rates is what moves the numbers. The grouping is the
 * app's own shape, stated.
 *
 * **An active state.** There was none. A rail with no active item is a list of
 * links, and on a screen you live in all day that is a small, constant tax.
 * The marker is copper — the one place the accent appears outside a price and
 * a primary action, and it earns it by being the answer to "where am I".
 *
 * **No phase badges.** `P1` and `P2` beside every item were roadmap
 * scaffolding: true of the project, useless to the person costing a cable.
 * They are gone. The waiting count stays, because that is work.
 *
 * A server component. The middleware already forwards the path it is
 * answering, so knowing which item is active costs no JavaScript.
 */

interface Item {
  readonly label: string;
  readonly href: string;
}

const GROUPS: readonly { readonly heading: string; readonly items: readonly Item[] }[] = [
  {
    heading: 'Work',
    items: [
      { label: 'Inbox', href: '/' },
      { label: 'Quotes', href: '/quotes' },
      { label: 'History', href: '/history' },
    ],
  },
  {
    heading: 'Library',
    items: [
      { label: 'Catalogue', href: '/catalogue' },
      { label: 'Vocabulary', href: '/vocabulary' },
      { label: 'Coverage', href: '/coverage' },
    ],
  },
  {
    heading: 'Rates',
    items: [
      { label: 'Rate Desk', href: '/rates' },
      { label: 'Price Watch', href: '/price-watch' },
    ],
  },
];

/**
 * Which item owns this path.
 *
 * Longest matching prefix, so `/quotes/Q-2026-0007` lights Quotes and not
 * Inbox. `/` is exact — otherwise it would match everything.
 */
function activeHref(path: string | null): string | null {
  if (path === null) return null;
  if (path === '/') return '/';

  let best: string | null = null;
  for (const group of GROUPS) {
    for (const item of group.items) {
      if (item.href === '/') continue;
      if (path === item.href || path.startsWith(`${item.href}/`)) {
        if (best === null || item.href.length > best.length) best = item.href;
      }
    }
  }
  // A job screen is where an enquiry from the Inbox is worked on.
  if (best === null && path.startsWith('/jobs/')) return '/';
  return best;
}

export function Rail({
  actor,
  waiting,
  path,
}: {
  readonly actor: Actor | null;
  readonly waiting: number;
  readonly path: string | null;
}) {
  const active = activeHref(path);

  return (
    <nav
      className="shrink-0 flex flex-col sticky top-0"
      style={{
        width: 'var(--rail-width)',
        height: '100vh',
        borderRight: '1px solid var(--color-line-panel)',
        backgroundColor: 'var(--color-surface-inset)',
      }}
    >
      <div
        className="flex items-center"
        style={{ padding: '18px 18px 16px', gap: 10 }}
      >
        {/*
          Placeholder for the Nuhas Oman mark. A copper square rather than a
          letterform, so nobody mistakes it for a finished logo.
        */}
        <div
          aria-hidden
          style={{
            width: 22,
            height: 22,
            borderRadius: 6,
            backgroundColor: 'var(--color-copper)',
            flexShrink: 0,
          }}
        />
        <div style={{ lineHeight: 1.15 }}>
          <div
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 13.5,
              fontWeight: 600,
              letterSpacing: '-0.01em',
            }}
          >
            Cable Quoting
          </div>
          <div
            style={{
              fontSize: 'var(--text-mono-micro)',
              color: 'var(--color-ink-tertiary)',
              letterSpacing: '0.04em',
            }}
          >
            NUHAS OMAN LLC
          </div>
        </div>
      </div>

      <div className="flex-1" style={{ padding: '4px 10px', overflowY: 'auto' }}>
        <ul className="flex flex-col" style={{ gap: 18 }}>
          {GROUPS.map((group) => (
            <li key={group.heading}>
              <div className="label" style={{ color: 'var(--color-ink-faint)', padding: '0 8px 6px' }}>
                {group.heading}
              </div>
              <ul className="flex flex-col" style={{ gap: 2 }}>
                {group.items.map((item) => (
                  <li key={item.href}>
                    <a
                      href={item.href}
                      aria-current={item.href === active ? 'page' : undefined}
                      className="rail-item flex items-center justify-between"
                      data-active={item.href === active}
                      style={{
                        height: 32,
                        padding: '0 10px',
                        borderRadius: 'var(--radius-control)',
                        fontSize: 13,
                      }}
                    >
                      <span className="flex items-center" style={{ gap: 10 }}>
                        {/*
                          The marker carries the active state, not the label
                          colour alone — colour is never the only signal.
                        */}
                        <span
                          aria-hidden
                          className="rail-marker"
                          style={{ width: 2, height: 14, borderRadius: 2, flexShrink: 0 }}
                        />
                        {item.label}
                      </span>
                      {item.href === '/' && waiting > 0 ? (
                        <span
                          className="numeric"
                          style={{
                            fontSize: 11,
                            lineHeight: '17px',
                            padding: '0 6px',
                            borderRadius: 5,
                            backgroundColor: 'var(--color-copper)',
                            color: 'var(--color-ink-on-copper)',
                          }}
                          title={`${waiting} ${waiting === 1 ? 'enquiry is' : 'enquiries are'} waiting on a person`}
                        >
                          {waiting}
                        </span>
                      ) : null}
                    </a>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </div>

      {actor === null ? null : <WhoAmI name={actor.name} role={roleLabel(actor.role)} />}
    </nav>
  );
}
