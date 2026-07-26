import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verify } from '@/infra/auth/token';

/**
 * The perimeter.
 *
 * Until this file existed, sign-in was something each page had to remember,
 * and five of them did. The rest were public: `/rates` served 114 rate codes
 * with their prices, and a product page served the full bill of materials with
 * supplier codes and consumptions, to anyone who knew the URL. That is Nuhas's
 * entire cost structure — the thing a competitor would most like to have.
 *
 * The gate is here rather than on each page because *a page added next month
 * cannot forget it*. That is the whole argument. A convention every author has
 * to follow is not a control; it is a hope, and this app has already shown
 * what happens to it.
 *
 * **This is the perimeter, not the authority.** It answers one question — is
 * this request carrying a session this app signed? — and answers it without a
 * database, because middleware runs before the app and on every request
 * including static assets. Whether the account still exists, is still enabled,
 * and may do the thing being asked is decided by `session.currentActor()` and
 * `can()` inside the page, where the answer can be acted on properly.
 *
 * Failing closed is deliberate in both directions: an unsigned request is
 * turned away, and a request the middleware cannot judge — a malformed cookie,
 * a missing `AUTH_SECRET` — is turned away too.
 */

/**
 * The only paths an anonymous request may reach.
 *
 * Kept as an explicit list rather than a pattern, so adding one is a decision
 * somebody makes on purpose and a reviewer can see in a diff.
 */
const PUBLIC = new Set(['/sign-in']);

/**
 * Where the middleware tells the app which path it is answering.
 *
 * The layout performs the check this file cannot — whether the account behind
 * a validly-signed cookie still exists and is still enabled — and to do that
 * without redirecting the sign-in screen to itself for ever, it has to know
 * which page it is rendering. Next does not give a layout its own path, so the
 * perimeter that already knows it says so.
 */
export const PATH_HEADER = 'x-cq-pathname';

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  const forward = new Headers(request.headers);
  forward.set(PATH_HEADER, pathname);
  const carry = () => NextResponse.next({ request: { headers: forward } });

  if (PUBLIC.has(pathname)) return carry();

  const token = request.cookies.get(SESSION_COOKIE)?.value;

  let signedIn = false;
  if (token !== undefined) {
    try {
      signedIn = (await verify(token)) !== null;
    } catch {
      // A misconfigured AUTH_SECRET must lock the app, never open it.
      signedIn = false;
    }
  }

  if (signedIn) return carry();

  const to = request.nextUrl.clone();
  to.pathname = '/sign-in';
  to.search = '';
  // Where they were going, so a link to a quote works on the first attempt
  // rather than the second. Validated again in the sign-in action, because a
  // query string is not a thing to trust with a redirect.
  if (pathname !== '/') to.searchParams.set('next', `${pathname}${search}`);
  return NextResponse.redirect(to);
}

export const config = {
  /*
    Everything except Next's own build output.

    Written as an exclusion rather than a list of protected routes, for the
    same reason the gate is here at all: a new route is protected by default
    and has to be let out deliberately.

    **The file-extension exclusion is gone, and it was a hole.** It read as
    "skip static assets" and meant "skip any path that happens to end in
    `.png`" — which a dynamic segment can. Anonymous, `/catalogue/<code>.png`
    answered 500 while `/catalogue/<code>` answered a redirect: the 500 is the
    tell, because a request that never reached the app cannot crash it. That
    route had run its database queries for a caller with no session.

    Whether anything readable came back depended on no real item code ending
    in `.png`, which is not a security boundary, it is a coincidence.

    Nothing is lost by dropping it: there is no `public/` directory in this
    app, so the only static files are under `_next`, which is still excluded.
    If one is ever added, it will need sign-in — which for a factory's costing
    tool is the right default, and has to be an explicit decision rather than
    a side effect of a regex.
  */
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
