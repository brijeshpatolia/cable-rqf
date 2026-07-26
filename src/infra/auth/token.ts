/**
 * The session token, signed and verified.
 *
 * Split out of `session.ts` and written against Web Crypto rather than
 * `node:crypto` for one reason: **the middleware needs it.** Middleware is
 * where the app's perimeter lives, and it does not run in the Node runtime.
 *
 * One implementation, used by both. Two would be worse than the duplication
 * looks: a signing path and a verifying path that drift apart do not fail
 * loudly, they lock every user out or — far worse — let a forged cookie
 * through at exactly one of the two checkpoints.
 *
 * `crypto.subtle` is a global in Node 18+ and on the Edge runtime, so the same
 * code runs unchanged in a Server Action, a Server Component and middleware.
 */

const DURATION_MS = 12 * 60 * 60 * 1000; // one working day

export interface Claims {
  readonly sub: string;
  readonly exp: number;
}

/**
 * `Uint8Array<ArrayBuffer>`, not `Uint8Array<ArrayBufferLike>`.
 *
 * Web Crypto will not take a view that might sit on a `SharedArrayBuffer`, and
 * TypeScript is right to insist: the bytes under a shared buffer can change
 * while the algorithm reads them. Encoding into a fresh array settles it.
 */
function bytes(text: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(text.length * 3));
  const { written } = new TextEncoder().encodeInto(text, out);
  return out.subarray(0, written) as Uint8Array<ArrayBuffer>;
}

function secretBytes(): Uint8Array<ArrayBuffer> {
  const value = process.env['AUTH_SECRET'];
  if (value === undefined || value.length < 32) {
    throw new Error(
      'AUTH_SECRET is missing or too short. Generate one with ' +
        '`openssl rand -base64 32` and set it in the environment.',
    );
  }
  return bytes(value);
}

async function key(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    secretBytes(),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

/** base64url, without the padding — safe in a cookie and in a URL. */
function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const out = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export async function issue(userId: string, at: Date = new Date()): Promise<string> {
  const payload = toBase64Url(
    bytes(JSON.stringify({ sub: userId, exp: at.getTime() + DURATION_MS })),
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    await key(),
    bytes(payload),
  );
  return `${payload}.${toBase64Url(new Uint8Array(signature))}`;
}

/**
 * Claims, or null. Never throws, and never explains which check failed.
 *
 * `crypto.subtle.verify` is constant-time, which is the property that matters:
 * comparing the signature byte by byte would leak how much of a forgery was
 * correct, one request at a time.
 */
export async function verify(
  token: string,
  at: Date = new Date(),
): Promise<Claims | null> {
  const [payload, signature] = token.split('.');
  if (payload === undefined || signature === undefined) return null;

  let ok = false;
  try {
    ok = await crypto.subtle.verify(
      'HMAC',
      await key(),
      fromBase64Url(signature),
      bytes(payload),
    );
  } catch {
    // A signature that is not even base64 is a forgery, not an error.
    return null;
  }
  if (!ok) return null;

  try {
    const claims = JSON.parse(new TextDecoder().decode(fromBase64Url(payload))) as Claims;
    if (typeof claims.sub !== 'string' || typeof claims.exp !== 'number') return null;
    if (claims.exp <= at.getTime()) return null;
    return claims;
  } catch {
    return null;
  }
}

export const SESSION_COOKIE = 'cq_session';

export const cookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env['NODE_ENV'] === 'production',
  path: '/',
  maxAge: DURATION_MS / 1000,
};
