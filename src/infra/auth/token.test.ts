import { beforeAll, describe, expect, it } from 'vitest';
import { issue, verify } from './token';

/**
 * The session token.
 *
 * One implementation signs and verifies, because the middleware and the page
 * code both need it and two implementations that drift apart do not fail
 * loudly — they lock every user out, or let a forgery through at exactly one
 * of the two checkpoints.
 *
 * Every assertion here is an attempt to get in with something the app did not
 * sign.
 */

const USER = '11111111-1111-1111-1111-111111111111';
const SESSION = '99999999-9999-9999-9999-999999999999';

/**
 * Signs an arbitrary payload with the app's own secret.
 *
 * The point is to test the checks *after* the signature. Borrowing a
 * signature from another token — the way these tests used to — leaves the
 * signature check as the thing doing the rejecting, so the assertion passes
 * whether or not the claim shape is examined at all.
 */
async function sign(payload: unknown): Promise<string> {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(process.env['AUTH_SECRET']),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(encoded));
  return `${encoded}.${Buffer.from(signature).toString('base64url')}`;
}

describe('session tokens', () => {
  beforeAll(() => {
    process.env['AUTH_SECRET'] = 'a-test-secret-that-is-long-enough-to-pass';
  });

  it('round-trips the user it was issued for', async () => {
    const claims = await verify(await issue(USER, SESSION));
    expect(claims?.sub).toBe(USER);
  });

  it('refuses a token whose payload was edited', async () => {
    const token = await issue(USER, SESSION);
    const [, signature] = token.split('.');
    const forged = Buffer.from(
      JSON.stringify({ sub: '22222222-2222-2222-2222-222222222222', exp: Date.now() + 1000 }),
    ).toString('base64url');

    expect(await verify(`${forged}.${signature}`)).toBeNull();
  });

  it('refuses a token signed with a different secret', async () => {
    const token = await issue(USER, SESSION);
    process.env['AUTH_SECRET'] = 'a-different-secret-that-is-also-long-enough';
    expect(await verify(token)).toBeNull();
    process.env['AUTH_SECRET'] = 'a-test-secret-that-is-long-enough-to-pass';
  });

  it('refuses an expired token', async () => {
    const issued = new Date('2026-01-01T00:00:00Z');
    const aDayLater = new Date('2026-01-02T00:00:00Z');
    expect(await verify(await issue(USER, SESSION, issued), aDayLater)).toBeNull();
  });

  it('accepts one inside its working day', async () => {
    const issued = new Date('2026-01-01T00:00:00Z');
    const sameShift = new Date('2026-01-01T08:00:00Z');
    expect((await verify(await issue(USER, SESSION, issued), sameShift))?.sub).toBe(USER);
  });

  it('refuses rubbish without throwing', async () => {
    for (const rubbish of ['', '.', 'a.b', 'no-dot-at-all', '!!!.???', 'a'.repeat(5000)]) {
      expect(await verify(rubbish)).toBeNull();
    }
  });

  it('refuses a payload that is not a claim, however it is signed', async () => {
    // Carrying nothing the app can act on. Reaching for `claims.sub` on it
    // would put `undefined` into a user lookup.
    //
    // Genuinely re-signed rather than borrowed from another token: pairing a
    // new payload with an old signature fails the signature check, which is a
    // real refusal but not the one this test claims to be about. Signed
    // properly, the only thing left to reject it is the shape check.
    expect(await verify(await sign({ hello: 'world' }))).toBeNull();
  });

  it('carries the session it belongs to, so signing out can end it', async () => {
    // The claim `currentActor()` looks up. Without it the token is a promise
    // nobody can take back: the cookie can be deleted from one browser and
    // every copy of it keeps working for the rest of the twelve hours.
    const claims = await verify(await issue(USER, SESSION));
    expect(claims?.sid).toBe(SESSION);
  });

  it('refuses a validly-signed token whose session id is not a string', async () => {
    // What a leaked secret, or a bug in `issue`, could produce. `sid` goes
    // into a `::uuid` cast, where a non-string is a 500 rather than a refusal.
    const odd = { sub: USER, sid: { nice: 'try' }, exp: Date.now() + 60_000 };
    expect(await verify(await sign(odd))).toBeNull();
  });

  it('will not run without a secret worth the name', async () => {
    process.env['AUTH_SECRET'] = 'short';
    await expect(issue(USER, SESSION)).rejects.toThrow(/AUTH_SECRET/);
    process.env['AUTH_SECRET'] = 'a-test-secret-that-is-long-enough-to-pass';
  });

  it('will not run on a placeholder that happens to be long enough', async () => {
    /*
      The first is the exact value in `.env.local.example`, which is thirty-four
      characters and passed the only check there was. A deployment that forgot
      to set the variable properly would have signed every session in the app
      with a string printed in the repository.
    */
    for (const placeholder of [
      'replace-me-with-32-bytes-of-random',
      'change_me_change_me_change_me_change_me',
      'your-secret-goes-right-here-okay-then',
      'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    ]) {
      process.env['AUTH_SECRET'] = placeholder;
      await expect(issue(USER, SESSION)).rejects.toThrow(/placeholder/i);
    }
    process.env['AUTH_SECRET'] = 'a-test-secret-that-is-long-enough-to-pass';
  });
});
