import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

/**
 * Password hashing.
 *
 * scrypt from Node's standard library rather than argon2 or bcrypt: it is a
 * memory-hard KDF, it is already here, and it needs no native build step on
 * Vercel. For ~10 internal accounts created by an administrator with no
 * self-signup, that is proportionate.
 *
 * Said plainly: passwords are the weakest part of this design. They exist
 * because no identity provider is configured yet, and they sit behind
 * `modules/auth`'s SessionReader port so moving to Google or Microsoft later
 * is one adapter file. Users are keyed by email precisely so that switch
 * preserves every account and every audit row.
 */

type ScryptOptions = { N: number; r: number; p: number; maxmem: number };

/**
 * `promisify` collapses scrypt's overloads and loses the options argument, so
 * the signature is restated rather than casting at each call site.
 */
const scryptAsync = promisify(scrypt) as unknown as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>;

/** OWASP's floor for scrypt at the time of writing. */
const COST = 2 ** 16;
const BLOCK_SIZE = 8;
const PARALLELISM = 1;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

const PARAMS = { N: COST, r: BLOCK_SIZE, p: PARALLELISM, maxmem: 256 * 1024 * 1024 };

/**
 * `scrypt$N$r$p$salt$hash` — parameters stored alongside the hash so they can
 * be raised later without invalidating existing passwords.
 */
export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = await scryptAsync(plain, salt, KEY_LENGTH, PARAMS);
  return [
    'scrypt',
    COST,
    BLOCK_SIZE,
    PARALLELISM,
    salt.toString('base64url'),
    derived.toString('base64url'),
  ].join('$');
}

export async function verifyPassword(
  plain: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const [, n, r, p, saltB64, hashB64] = parts;
  const salt = Buffer.from(saltB64!, 'base64url');
  const expected = Buffer.from(hashB64!, 'base64url');

  const derived = await scryptAsync(plain, salt, expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: 256 * 1024 * 1024,
  });

  // Constant-time: a length-varying or short-circuiting compare leaks how much
  // of the hash matched.
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

/**
 * A password for an account an administrator creates.
 *
 * Deliberately long and random rather than memorable — it is shown once, and
 * the expectation is that it goes into a password manager.
 */
export function generatePassword(): string {
  // Avoids look-alike characters, because this gets read aloud or retyped.
  const alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(20);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}
