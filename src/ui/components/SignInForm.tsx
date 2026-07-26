'use client';

import { useActionState } from 'react';
import { signIn } from '@/app/sign-in/actions';
import { Panel } from '@/ui/components/Panel';

/**
 * Sign in.
 *
 * The only screen in the app with nothing on it. Deliberately plain — an
 * instrument does not greet you.
 *
 * `next` arrives as a prop rather than from `useSearchParams()`. The hook
 * needs a Suspense boundary and forces this page to render on the client;
 * reading the query string on the server instead means the destination is in
 * the markup at first paint, and there is no boundary to remember. The
 * production build is what found that — it prerenders, and dev does not.
 */
export function SignInForm({ next }: { readonly next: string }) {
  const [state, action, pending] = useActionState(signIn, {});

  return (
    <div
      className="flex min-h-screen items-center justify-center"
      style={{ padding: 24 }}
    >
      <div style={{ width: 340 }}>
        <div style={{ marginBottom: 20 }}>
          <div
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 'var(--text-display-sm)',
              lineHeight: 'var(--text-display-sm--line-height)',
              letterSpacing: 'var(--text-display-sm--letter-spacing)',
              fontWeight: 500,
            }}
          >
            Cable Quoting
          </div>
          <div className="label" style={{ marginTop: 4 }}>
            Sign in
          </div>
        </div>

        <Panel>
          <form action={action} className="flex flex-col gap-4">
            {/* Where the middleware turned them away from, carried through so
                a link to a quote works on the first attempt. The action
                validates it — a query string is not a thing to trust with a
                redirect. */}
            <input type="hidden" name="next" value={next} />
            <label className="flex flex-col gap-1">
              <span className="label">Email</span>
              <input
                name="email"
                type="email"
                autoComplete="username"
                autoFocus
                required
                style={inputStyle}
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="label">Password</span>
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                required
                style={inputStyle}
              />
            </label>

            {state.error !== undefined ? (
              <p
                role="alert"
                style={{
                  color: 'var(--color-status-manual)',
                  fontSize: 'var(--text-micro)',
                  lineHeight: 'var(--text-micro--line-height)',
                }}
              >
                {state.error}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={pending}
              style={{
                backgroundColor: pending
                  ? 'var(--color-surface-raised)'
                  : 'var(--color-copper)',
                color: pending
                  ? 'var(--color-ink-tertiary)'
                  : 'var(--color-ink-on-copper)',
                borderRadius: 'var(--radius-md)',
                padding: '8px 12px',
                fontWeight: 550,
                minHeight: 'var(--row-height)',
                marginTop: 4,
              }}
            >
              {pending ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </Panel>

        <p
          style={{
            marginTop: 16,
            color: 'var(--color-ink-tertiary)',
            fontSize: 'var(--text-micro)',
            lineHeight: 'var(--text-micro--line-height)',
          }}
        >
          Accounts are created by the administrator. There is no self-signup.
        </p>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  backgroundColor: 'var(--color-surface-base)',
  border: '1px solid var(--color-line-strong)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--color-ink-primary)',
  padding: '6px 10px',
  fontSize: 'var(--text-body)',
  minHeight: 'var(--row-height)',
};
