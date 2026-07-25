'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { prisma } from '@/infra/db/client';
import { verifyPassword } from '@/infra/auth/password';
import { SESSION_COOKIE, cookieOptions, issue } from '@/infra/auth/session';

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

  const store = await cookies();
  store.set(SESSION_COOKIE, issue(user.id), cookieOptions);

  redirect('/rates');
}

export async function signOut(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  redirect('/sign-in');
}
