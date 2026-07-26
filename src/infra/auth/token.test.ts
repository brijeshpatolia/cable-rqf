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

describe('session tokens', () => {
  beforeAll(() => {
    process.env['AUTH_SECRET'] = 'a-test-secret-that-is-long-enough-to-pass';
  });

  it('round-trips the user it was issued for', async () => {
    const claims = await verify(await issue(USER));
    expect(claims?.sub).toBe(USER);
  });

  it('refuses a token whose payload was edited', async () => {
    const token = await issue(USER);
    const [, signature] = token.split('.');
    const forged = Buffer.from(
      JSON.stringify({ sub: '22222222-2222-2222-2222-222222222222', exp: Date.now() + 1000 }),
    ).toString('base64url');

    expect(await verify(`${forged}.${signature}`)).toBeNull();
  });

  it('refuses a token signed with a different secret', async () => {
    const token = await issue(USER);
    process.env['AUTH_SECRET'] = 'a-different-secret-that-is-also-long-enough';
    expect(await verify(token)).toBeNull();
    process.env['AUTH_SECRET'] = 'a-test-secret-that-is-long-enough-to-pass';
  });

  it('refuses an expired token', async () => {
    const issued = new Date('2026-01-01T00:00:00Z');
    const aDayLater = new Date('2026-01-02T00:00:00Z');
    expect(await verify(await issue(USER, issued), aDayLater)).toBeNull();
  });

  it('accepts one inside its working day', async () => {
    const issued = new Date('2026-01-01T00:00:00Z');
    const sameShift = new Date('2026-01-01T08:00:00Z');
    expect((await verify(await issue(USER, issued), sameShift))?.sub).toBe(USER);
  });

  it('refuses rubbish without throwing', async () => {
    for (const rubbish of ['', '.', 'a.b', 'no-dot-at-all', '!!!.???', 'a'.repeat(5000)]) {
      expect(await verify(rubbish)).toBeNull();
    }
  });

  it('refuses a well-signed payload that is not a claim', async () => {
    // Signed by this app, but carrying nothing it can act on. Reaching for
    // `claims.sub` on it would put `undefined` into a user lookup.
    const empty = Buffer.from(JSON.stringify({ hello: 'world' })).toString('base64url');
    const token = await issue(USER);
    expect(await verify(`${empty}.${token.split('.')[1]}`)).toBeNull();
  });

  it('will not run without a secret worth the name', async () => {
    process.env['AUTH_SECRET'] = 'short';
    await expect(issue(USER)).rejects.toThrow(/AUTH_SECRET/);
    process.env['AUTH_SECRET'] = 'a-test-secret-that-is-long-enough-to-pass';
  });
});
