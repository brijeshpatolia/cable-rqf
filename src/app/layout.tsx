import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { now } from '@/infra/clock';
import { SESSION_COOKIE, session } from '@/infra/auth/session';
import { PATH_HEADER } from '@/middleware';
import { jobStore, repositories } from '@/infra/repositories';
import { Rail } from '@/ui/shell/Rail';
import { Ticker } from '@/ui/shell/Ticker';
import './globals.css';

export const metadata: Metadata = {
  title: 'Cable Quoting',
  description: 'RFQ to priced quotation, on live copper.',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  /*
    Read here rather than passed down from each page: the rail is on every
    screen, and threading the actor through fifteen pages to render one block
    would be the kind of ceremony that stops being done consistently.

    Null on the sign-in screen, which is the only place there is nobody yet.
  */
  const actor = await session.currentActor();

  /*
    The enablement check, in the one place every screen passes through.

    The middleware is a perimeter and can only ask whether a cookie was signed
    by this app — it runs before the app, on the Edge, with no database. That
    leaves a gap it cannot close on its own: a session issued to somebody whose
    account has since been disabled or deleted stays *validly signed* for the
    rest of its twelve hours. Pages that call `can()` degrade gracefully to a
    read-only view for such a session, which sounds harmless and is not — the
    read-only view of the Rate Desk is the entire cost master.

    Screens that already redirect on a null actor were fine; several read-only
    ones never did, and asking each new page to remember is the habit that put
    ten screens on the public internet in the first place. So it lives here.

    The sign-in screen is exempt, and finding out why cost a redirect loop: it
    renders through this same layout, and a stale cookie is not cleared by
    being turned away, so it bounced to itself for ever. The middleware
    forwards the path precisely so this one exception can be stated.
  */
  const path = (await headers()).get(PATH_HEADER);
  const presented = (await cookies()).has(SESSION_COOKIE);
  if (actor === null && presented && path !== '/sign-in') redirect('/sign-in');

  /*
    Enquiries waiting on a person, and the copper the app prices against.

    Only read when there is somebody to read them for, so the sign-in screen
    costs no query. The LME series is a short history — enough for a sparkline
    to show a direction, not enough to be a chart.
  */
  const asOf = now();
  const [waiting, ticks] =
    actor === null
      ? ([0, []] as const)
      : await Promise.all([
          jobStore.awaitingCount(),
          /*
            Caught, because the ticker is chrome and the shell is not. Both of
            these are awaited in the root layout, so an unreadable copper
            history would otherwise propagate out of the layout and take down
            every authenticated screen — including the Rate Desk, which does
            not depend on copper history at all. A ticker that cannot be drawn
            hides itself; it does not hide the screen behind it.
          */
          repositories.rates.lmeHistory(23).catch(() => []),
        ]);

  // `lmeHistory` is newest-first; a sparkline reads left to right in time.
  const series = [...ticks].reverse();
  const latest = series.at(-1);

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
          <Rail actor={actor} waiting={waiting} />

          <div className="min-w-0 flex-1 flex flex-col">
            {actor === null || latest === undefined ? null : (
              <header
                className="sticky top-0 flex items-center"
                style={{
                  height: 'var(--topbar-height)',
                  padding: '0 24px',
                  zIndex: 5,
                  borderBottom: '1px solid var(--color-line-panel)',
                  backgroundColor: 'rgba(11, 14, 19, 0.92)',
                  backdropFilter: 'blur(12px)',
                  WebkitBackdropFilter: 'blur(12px)',
                }}
              >
                {/*
                  The handoff draws a search field and a ⌘K key cap here and
                  says both are chrome — drawn, not built. They are left out
                  rather than drawn dead: this app's own rule is that a
                  disabled action states its condition, and a search box that
                  silently does nothing is the loudest possible breach of it.
                  The bar reads correctly without them, because the ticker is
                  right-aligned regardless.
                */}
                <Ticker
                  points={series.map((t) => Number(t.lme.toString()))}
                  lme={latest.lme}
                  asOf={asOf}
                />
              </header>
            )}

            <main
              className="min-w-0 flex-1 flex flex-col w-full mx-auto"
              style={{
                // Centred, or the content pins to the rail on a wide display
                // while the ticker stays flush right and the two stop sharing
                // an edge.
                maxWidth: 'var(--content-max)',
                padding: '28px 24px 40px',
                gap: 24,
              }}
            >
              {children}
            </main>
          </div>
        </div>
      </body>
    </html>
  );
}
