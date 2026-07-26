import { redirect } from 'next/navigation';
import { session } from '@/infra/auth/session';
import { type Actor, authorise } from '@/modules/auth';

/**
 * The authoritative read check for a quote.
 *
 * The whole app is behind sign-in now — the middleware turns away anything
 * without a session before it reaches a page. This is still here, and is not
 * redundant: the middleware is a perimeter that knows only whether a cookie
 * was signed, and this is what knows whether the account still exists, is
 * still enabled, and may read at all.
 *
 * Kept on quotes in particular because they are the worst thing to leak: a
 * quote carries the customer's name, the price they were given, and the
 * complete internal cost build-up behind it, at a URL an outsider can guess in
 * one try (`Q-2026-0001`).
 */
export async function requireRead(): Promise<Actor> {
  const actor = await session.currentActor();
  const permitted = authorise(actor, 'read');
  if (!permitted.ok) redirect('/sign-in');
  return permitted.actor;
}

/** The same check for a document route, where a redirect to HTML is no use. */
export async function requireReadForDocument(): Promise<Actor | Response> {
  const actor = await session.currentActor();
  const permitted = authorise(actor, 'read');
  if (!permitted.ok) {
    return new Response(permitted.failure.message, {
      status: permitted.failure.kind === 'UNAUTHENTICATED' ? 401 : 403,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
  return permitted.actor;
}
