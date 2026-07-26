'use server';

import type { Route } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { prisma } from '@/infra/db/client';
import { verifyPassword } from '@/infra/auth/password';
import {
  DURATION_MS,
  SESSION_COOKIE,
  cookieOptions,
  issue,
  revoke,
} from '@/infra/auth/session';

/**
 * Sign in.
 *
 * One deliberate choice: a wrong email and a wrong password produce the same
 * message and take the same time. Telling an attacker which half was right
 * turns a password guess into an account enumeration.
 */
export async function signIn(
  _previous: { error?: string } | null,
  form: FormData,
): Promise<{ error?: string }> {
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  const password = String(form.get('password') ?? '');

  if (email === '' || password === '') {
    return { error: 'Enter an email address and password.' };
  }

  const rows = await prisma.$queryRaw<
    { id: string; hash: string | null; disabled: Date | null }[]
  >`SELECT id::text, password_hash AS hash, disabled_at AS disabled
      FROM app_user WHERE email = ${email}`;

  const user = rows[0];

  // Verify against a decoy when the account does not exist, so the response
  // time does not reveal whether the email is known.
  const stored =
    user?.hash ??
    'scrypt$65536$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

  const ok = await verifyPassword(password, stored);

  if (user === undefined || user.hash === null || !ok || user.disabled !== null) {
    return { error: 'That email and password do not match an active account.' };
  }

  /*
    The session row comes first, and the token is issued against it.

    The cookie is a signed statement and cannot be withdrawn once it leaves;
    this row is the thing that can be. Written before the token so there is
    never a token pointing at a session that does not exist — `currentActor()`
    would refuse it, which is safe, but it would also be a sign-in that
    silently did not work.
  */
  const opened = await prisma.appSession.create({
    data: { userId: user.id, expiresAt: new Date(Date.now() + DURATION_MS) },
    select: { id: true },
  });

  const store = await cookies();
  store.set(SESSION_COOKIE, await issue(user.id, opened.id), cookieOptions);

  /*
    Back to where they were going.

    Middleware turns an anonymous request away and remembers the path it was
    for. Landing everyone on the Rate Desk instead would mean a link to a quote
    sent to a colleague works only on their second attempt.

    The destination is checked, not trusted: it comes from a query string, so
    anything but a path on this app would make the sign-in form an open
    redirect — a phishing link that genuinely begins on Nuhas's domain.
  */
  redirect(safeNext(String(form.get('next') ?? '')) as Route);
}

/** An origin that cannot exist, used only to resolve a relative path against. */
const INTERNAL = 'https://internal.invalid';

/**
 * A destination this app is willing to send someone to after signing in.
 *
 * **Parsed, not pattern-matched.** The first version of this checked for a
 * leading slash and rejected a doubled one, which reads as sufficient and is
 * not: browsers normalise a backslash to a slash inside a URL, so a path
 * beginning slash-backslash is a protocol-relative URL to somebody else's site
 * and passes both tests. An open redirect on a sign-in form is worth a great
 * deal to an attacker, because the phishing link genuinely begins on Nuhas's
 * own domain.
 *
 * Resolving against a throwaway origin settles every variant at once —
 * backslashes, encoded slashes, embedded control characters, a scheme with one
 * slash — because whatever a browser would make of it, the parser has already
 * made. Anything that lands off that origin is not ours to send people to.
 */
function safeNext(next: string): `/${string}` {
  let url: URL;
  try {
    url = new URL(next, INTERNAL);
  } catch {
    return '/rates';
  }
  if (url.origin !== INTERNAL) return '/rates';

  // Never back to the form they have just filled in.
  if (url.pathname === '/sign-in' || url.pathname === '/sign-in/') return '/rates';

  const path = `${url.pathname}${url.search}`;
  return path.startsWith('/') ? (path as `/${string}`) : '/rates';
}

/**
 * Sign out.
 *
 * Deleting the cookie is the visible half and was, until now, the only half:
 * the token stayed valid for the rest of its twelve hours, so a copy taken
 * from a shared machine or a proxy log kept working and nothing anyone could
 * do in this app would stop it. Ending the session row is what makes the
 * button mean what it says.
 *
 * The row is ended first. If that fails the cookie stays put and the person
 * sees they are still signed in, which is true; clearing it first and failing
 * afterwards would show them a sign-in screen while the session they wanted
 * ended was still live.
 */
export async function signOut(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token !== undefined) await revoke(token);
  store.delete(SESSION_COOKIE);
  redirect('/sign-in');
}
