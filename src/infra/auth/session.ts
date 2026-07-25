import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import type { PrismaClient } from '@prisma/client';
import type { Actor, Role, SessionReader } from '@/modules/auth';
import { prisma as defaultClient } from '@/infra/db/client';

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
 * This is the one adapter that would be replaced by OIDC. `modules/auth`
 * declares the `SessionReader` port; nothing above this file knows a cookie
 * is involved.
 */

export const SESSION_COOKIE = 'cq_session';

const DURATION_MS = 12 * 60 * 60 * 1000; // one working day

function secret(): Buffer {
  const value = process.env['AUTH_SECRET'];
  if (value === undefined || value.length < 32) {
    throw new Error(
      'AUTH_SECRET is missing or too short. Generate one with ' +
        '`openssl rand -base64 32` and set it in the environment.',
    );
  }
  return Buffer.from(value, 'utf8');
}

function sign(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('base64url');
}

export function issue(userId: string, at: Date = new Date()): string {
  const payload = Buffer.from(
    JSON.stringify({ sub: userId, exp: at.getTime() + DURATION_MS }),
  ).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

interface Claims {
  readonly sub: string;
  readonly exp: number;
}

function verify(token: string, at: Date = new Date()): Claims | null {
  const [payload, signature] = token.split('.');
  if (payload === undefined || signature === undefined) return null;

  const expected = Buffer.from(sign(payload), 'base64url');
  const actual = Buffer.from(signature, 'base64url');
  if (expected.length !== actual.length) return null;
  if (!timingSafeEqual(expected, actual)) return null;

  try {
    const claims = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8'),
    ) as Claims;
    if (typeof claims.sub !== 'string' || typeof claims.exp !== 'number') {
      return null;
    }
    if (claims.exp <= at.getTime()) return null;
    return claims;
  } catch {
    return null;
  }
}

export class CookieSessionReader implements SessionReader {
  constructor(private readonly db: PrismaClient = defaultClient) {}

  async currentActor(): Promise<Actor | null> {
    const store = await cookies();
    const token = store.get(SESSION_COOKIE)?.value;
    if (token === undefined) return null;

    const claims = verify(token);
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

export const cookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env['NODE_ENV'] === 'production',
  path: '/',
  maxAge: DURATION_MS / 1000,
};
