import { signOut } from '@/app/sign-in/actions';

/**
 * Who you are, and how to stop being them.
 *
 * The `signOut` action existed from the first sign-in commit and nothing ever
 * called it. That was survivable while most of the app was readable without a
 * session; it stopped being survivable the moment every screen went behind
 * one. A twelve-hour session on a shared machine in a factory office means the
 * next person to sit down is, as far as the app is concerned, the previous
 * person — and every rate change and quote approval they make is recorded
 * against that name, in an audit trail nobody can edit afterwards.
 *
 * The role is stated for a different reason. Controls are hidden by role all
 * over the app, and a screen that silently omits a button is indistinguishable
 * from a broken one. Naming the role turns "where is the approve button" into
 * "ah, I am signed in as the Rate Owner".
 *
 * A form rather than a link: signing out is a state change, and a `GET` that
 * changes state is one prefetch away from logging people out by accident.
 */
export function WhoAmI({
  name,
  role,
}: {
  readonly name: string;
  readonly role: string;
}) {
  return (
    <div
      style={{
        padding: '10px 16px',
        borderTop: '1px solid var(--color-line-hairline)',
      }}
    >
      <div
        style={{
          color: 'var(--color-ink-secondary)',
          fontSize: 'var(--text-micro)',
          lineHeight: 'var(--text-micro--line-height)',
          overflowWrap: 'anywhere',
        }}
      >
        {name}
      </div>
      <div className="label" style={{ marginTop: 2 }}>
        {role}
      </div>
      <form action={signOut}>
        <button
          type="submit"
          className="mt-2"
          style={{
            border: '1px solid var(--color-line-strong)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--color-ink-secondary)',
            padding: '3px 10px',
            fontSize: 'var(--text-micro)',
            width: '100%',
          }}
        >
          Sign out
        </button>
      </form>
    </div>
  );
}
