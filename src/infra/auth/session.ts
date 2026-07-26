import { cookies } from 'next/headers';
import type { PrismaClient } from '@prisma/client';
import type { Actor, Role, SessionReader } from '@/modules/auth';
import { prisma as defaultClient } from '@/infra/db/client';
import { SESSION_COOKIE, verify } from './token';

/**
 * Sessions, carried in a signed cookie.
 *
 * The cookie holds a user id and an expiry, signed with `AUTH_SECRET`. It is
 * not encrypted and does not need to be: it carries no secret, and the
 * signature is what stops anyone editing the id inside it. The role is never
 * put in the cookie — it is read from the database on every request, so
 * revoking someone's authority takes effect immediately rather than whenever
 * their cookie happens to expire.
 *
 * Signing and verifying live in `token.ts`, because the middleware needs them
 * too and does not run in the Node runtime.
 *
 * **This is the authoritative check, not the perimeter.** Middleware turns
 * anonymous traffic away before it reaches a page; this is what knows whether
 * the account still exists, is still enabled, and what it may do.
 *
 * This is the one adapter that would be replaced by OIDC. `modules/auth`
 * declares the `SessionReader` port; nothing above this file knows a cookie
 * is involved.
 */

export { SESSION_COOKIE, cookieOptions, DURATION_MS, issue } from './token';

export class CookieSessionReader implements SessionReader {
  constructor(private readonly db: PrismaClient = defaultClient) {}

  async currentActor(): Promise<Actor | null> {
    const store = await cookies();
    const token = store.get(SESSION_COOKIE)?.value;
    if (token === undefined) return null;

    const claims = await verify(token);
    if (claims === null) return null;

    /*
      A token with no session id behind it is not honoured.

      Those are the tokens issued before `app_session` existed. They verify —
      the signature is genuine — but there is no row to end, so signing out
      could not revoke one and neither could anybody else. Refusing them costs
      the handful of people signed in at deploy time one sign-in, and is the
      only way "sign out ends the session" is true of every session rather
      than of most of them.
    */
    if (claims.sid === undefined) return null;

    /*
      Both ids are cast to `uuid` below, and Postgres raises on a cast it
      cannot make rather than returning no rows. Checked here so a malformed
      claim is a refusal, the same as any other bad token, instead of a 500
      that tells whoever sent it they found something.
    */
    if (!UUID.test(claims.sub) || !UUID.test(claims.sid)) return null;

    /*
      One query, three questions: does the account still exist, is it still
      enabled, and is this particular sign-in still open. Joined rather than
      queried separately because they are answered together on every single
      request, and because two round trips would be two chances to answer half
      of it and carry on.

      `expires_at` is checked here as well as in the signature. The token's own
      expiry is the real one; this catches a row whose clock disagrees, and
      means a sweep of the table can be written against the column alone.
    */
    const rows = await this.db.$queryRaw<
      { id: string; email: string; name: string; role: Role; disabled: Date | null }[]
    >`SELECT u.id::text, u.email, u.name, u.role::text AS role, u.disabled_at AS disabled
        FROM app_session s
        JOIN app_user u ON u.id = s.user_id
       WHERE s.id = ${claims.sid}::uuid
         AND s.user_id = ${claims.sub}::uuid
         AND s.revoked_at IS NULL
         AND s.expires_at > now()`;

    const user = rows[0];
    if (user === undefined || user.disabled !== null) return null;

    return { id: user.id, email: user.email, name: user.name, role: user.role };
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The reader the app uses. One line to swap for an OIDC adapter. */
export const session = new CookieSessionReader();

/**
 * Ends the session the given token belongs to.
 *
 * Takes the token rather than a user id on purpose: signing out ends *this*
 * sign-in, not every sign-in the person has. Someone signing out of the shop
 * floor terminal should not be logged out of the laptop they left upstairs.
 *
 * Idempotent, and quiet about a token it cannot place. Sign-out has to work
 * even when there is nothing to work on — an expired token, a session already
 * ended, a cookie from a previous deployment — because the alternative is an
 * error page on the one control someone reaches for when they are worried.
 */
export async function revoke(
  token: string,
  db: PrismaClient = defaultClient,
): Promise<void> {
  const claims = await verify(token);
  if (claims?.sid === undefined || !UUID.test(claims.sid)) return;

  await db.appSession.updateMany({
    where: { id: claims.sid, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
