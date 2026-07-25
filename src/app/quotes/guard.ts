import { redirect } from 'next/navigation';
import { session } from '@/infra/auth/session';
import { type Actor, authorise } from '@/modules/auth';

/**
 * Quotes are behind sign-in, and the rest of the app is not — deliberately.
 *
 * A rate table is commercially sensitive; a quote is worse. It carries the
 * customer's name, the price they were given, and the complete internal cost
 * build-up behind it, at a URL an outsider can guess in one try
 * (`Q-2026-0001`). So every quote page and both export routes go through here.
 *
 * The rest of the app's screens will move behind the same check when sign-in
 * stops being optional. This is not that change; it is the part that cannot
 * wait for it.
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
