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

export { SESSION_COOKIE, cookieOptions, issue } from './token';

export class CookieSessionReader implements SessionReader {
  constructor(private readonly db: PrismaClient = defaultClient) {}

  async currentActor(): Promise<Actor | null> {
    const store = await cookies();
    const token = store.get(SESSION_COOKIE)?.value;
    if (token === undefined) return null;

    const claims = await verify(token);
    if (claims === null) return null;

    // Read the role fresh every request rather than trusting the cookie, so
    // a disabled account or a changed role takes effect on the next click.
    const rows = await this.db.$queryRaw<
      { id: string; email: string; name: string; role: Role; disabled: Date | null }[]
    >`SELECT id::text, email, name, role::text AS role, disabled_at AS disabled
        FROM app_user WHERE id = ${claims.sub}::uuid`;

    const user = rows[0];
    if (user === undefined || user.disabled !== null) return null;

    return { id: user.id, email: user.email, name: user.name, role: user.role };
  }
}

/** The reader the app uses. One line to swap for an OIDC adapter. */
export const session = new CookieSessionReader();
