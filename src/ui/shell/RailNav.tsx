'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * The rail's links, and the only part of the rail that knows where you are.
 *
 * **Why this is a client component when the rest of the rail is not.**
 *
 * The active state used to be computed on the server, from a path the
 * middleware forwards on the request. That worked for exactly as long as every
 * rail click was a full document load. Switching the items to `next/link` made
 * navigation client-side — which is the point, since the root layout reads the
 * actor, the waiting count and the copper history on every render — but a
 * client-side navigation deliberately does *not* re-render the layout above
 * the page that changed. The request header was therefore whatever it had been
 * on the last full load, so the marker stayed on the page you came from until
 * you happened to reload.
 *
 * A pathname read from the router rather than from a request header is the fix,
 * because the router is the thing that actually changed. It costs this one
 * small component's worth of JavaScript, and nothing above it: the header, the
 * mark and the signed-in footer stay on the server.
 */

interface Item {
  readonly label: string;
  /**
   * Typed routes are on, so this is the app's own route union rather than a
   * string — a rail item pointing at a page that does not exist is a build
   * failure, which is the right place to find out.
   */
  readonly href: Route;
}

interface Group {
  readonly heading: string;
  readonly items: readonly Item[];
}

export const GROUPS: readonly Group[] = [
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
 * Shown only to an administrator.
 *
 * Kept out of `GROUPS` rather than filtered out of it, so `activeHref` still
 * matches `/accounts` for everybody. The page itself redirects anyone without
 * the capability — hiding the link is a courtesy, not the control — and this
 * way a stale link lands somewhere sensible instead of lighting nothing.
 */
const ADMIN_GROUP: Group = {
  heading: 'Admin',
  items: [{ label: 'Accounts', href: '/accounts' }],
};

/** Every group, including the ones this actor may not see. For matching. */
const ALL: readonly Group[] = [...GROUPS, ADMIN_GROUP];

/**
 * Which item owns this path.
 *
 * Longest matching prefix, so `/quotes/Q-2026-0007` lights Quotes and not
 * Inbox. `/` is exact — otherwise it would match everything.
 */
export function activeHref(path: string | null): string | null {
  if (path === null) return null;
  if (path === '/') return '/';

  let best: string | null = null;
  for (const group of ALL) {
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

export function RailNav({
  waiting,
  canManageAccounts,
}: {
  readonly waiting: number;
  /** Resolved on the server from the actor's role, never inferred here. */
  readonly canManageAccounts: boolean;
}) {
  const active = activeHref(usePathname());
  const groups = canManageAccounts ? ALL : GROUPS;

  return (
    <div className="flex-1" style={{ padding: '4px 10px', overflowY: 'auto' }}>
      <ul className="flex flex-col" style={{ gap: 18 }}>
        {groups.map((group) => (
          <li key={group.heading}>
            <div
              className="label"
              style={{ color: 'var(--color-ink-faint)', padding: '0 8px 6px' }}
            >
              {group.heading}
            </div>
            <ul className="flex flex-col" style={{ gap: 2 }}>
              {group.items.map((item) => (
                <li key={item.href}>
                  {/*
                    `next/link`, not an anchor: the root layout reads the actor,
                    the waiting count and the copper history on every render,
                    and a full document load re-runs all three plus a fresh
                    parse. A client-side RSC navigation does not.
                  */}
                  <Link
                    href={item.href}
                    prefetch={false}
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
                  </Link>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}
