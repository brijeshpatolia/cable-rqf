import { SignInForm } from '@/ui/components/SignInForm';

export const metadata = { title: 'Sign in — Cable Quoting' };

/**
 * Sign in.
 *
 * A server component around a client form, only so the destination the
 * middleware remembered can be read here rather than from a browser hook.
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const { next } = await searchParams;
  // A repeated `?next=` arrives as an array. Taking the first is arbitrary but
  // harmless: the action validates whatever it is handed, and a request with
  // two destinations was never made by this app.
  const to = Array.isArray(next) ? (next[0] ?? '') : (next ?? '');

  return <SignInForm next={to} />;
}
