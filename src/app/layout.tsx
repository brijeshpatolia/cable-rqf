import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { session } from '@/infra/auth/session';
import { jobStore } from '@/infra/repositories';
import { roleLabel } from '@/modules/auth';
import { WhoAmI } from '@/ui/components/WhoAmI';
import './globals.css';

export const metadata: Metadata = {
  title: 'Cable Quoting',
  description: 'RFQ to priced quotation, on live copper.',
};

const NAV = [
  { label: 'Inbox', href: '/', phase: 2 },
  { label: 'Catalogue', href: '/catalogue', phase: 1 },
  { label: 'Quotes', href: '/quotes', phase: 2 },
  { label: 'Rate Desk', href: '/rates', phase: 1 },
  { label: 'Vocabulary', href: '/vocabulary', phase: 2 },
  { label: 'Price Watch', href: '/price-watch', phase: 1 },
  { label: 'History', href: '/history', phase: 1 },
  { label: 'Coverage', href: '/coverage', phase: 2 },
] as const;

export default async function RootLayout({ children }: { children: ReactNode }) {
  /*
    Read here rather than passed down from each page: the rail is on every
    screen, and threading the actor through fifteen pages to render one block
    would be the kind of ceremony that stops being done consistently.

    Null on the sign-in screen, which is the only place there is nobody yet.
  */
  const actor = await session.currentActor();

  /*
    Enquiries waiting on a person, as a small mono number beside Inbox — the
    plan is explicit that it is not a red circle. Red is one of this app's
    three status colours and it means *the app will not price this*; spending
    it on "there is work" would make the two indistinguishable at a glance.

    Only read when there is somebody to read it for, so the sign-in screen
    costs no query.
  */
  const waiting = actor === null ? 0 : await jobStore.awaitingCount();

  return (
    <html lang="en">
      <body>
        <div className="flex min-h-screen">
          {/*
            Stuck to the viewport, not to the page.

            The rail is a flex column so the identity block can sit at its
            foot — but a rail that stretched with the content would put "Sign
            out" a couple of thousand pixels below the fold on the Rate Desk.
            Nobody scrolls to the end of a rate table to leave.
          */}
          <nav
            className="shrink-0 flex flex-col sticky top-0"
            style={{
              width: 'var(--rail-width)',
              height: '100vh',
              borderRight: '1px solid var(--color-line-hairline)',
              backgroundColor: 'var(--color-surface-panel)',
            }}
          >
            <div
              style={{
                padding: '16px',
                borderBottom: '1px solid var(--color-line-hairline)',
              }}
            >
              <div
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: 'var(--text-heading)',
                  fontWeight: 550,
                  letterSpacing: '-0.01em',
                }}
              >
                Cable Quoting
              </div>
            </div>

            {/* Labels always visible — no icons-only mode. */}
            <ul className="flex-1" style={{ padding: '8px 0', overflowY: 'auto' }}>
              {NAV.map((item) => (
                <li key={item.href}>
                  <a
                    href={item.href}
                    className="flex items-center justify-between transition-colors"
                    style={{
                      padding: '6px 16px',
                      color: 'var(--color-ink-secondary)',
                      minHeight: 'var(--row-height)',
                    }}
                  >
                    {item.label}
                    {item.href === '/' && waiting > 0 ? (
                      <span
                        className="numeric"
                        style={{
                          color: 'var(--color-ink-primary)',
                          fontSize: 'var(--text-micro)',
                        }}
                        title={`${waiting} ${waiting === 1 ? 'enquiry is' : 'enquiries are'} waiting on a person`}
                      >
                        {waiting}
                      </span>
                    ) : (
                      <span
                        className="numeric"
                        style={{
                          color: 'var(--color-ink-tertiary)',
                          fontSize: 'var(--text-micro)',
                        }}
                        title={`Ships in phase ${item.phase}`}
                      >
                        P{item.phase}
                      </span>
                    )}
                  </a>
                </li>
              ))}
            </ul>

            {actor === null ? null : (
              <WhoAmI name={actor.name} role={roleLabel(actor.role)} />
            )}
          </nav>

          <main className="min-w-0 flex-1">{children}</main>
        </div>
      </body>
    </html>
  );
}
