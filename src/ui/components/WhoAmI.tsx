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
    <div style={{ padding: 12, borderTop: '1px solid var(--color-line-panel)' }}>
      <div className="flex items-center" style={{ gap: 10 }}>
        {/* Initials rather than an avatar: there are no photographs in a
            costing tool, and a coloured circle would be a second accent. */}
        <span
          aria-hidden
          className="numeric flex items-center justify-center"
          style={{
            width: 26,
            height: 26,
            flexShrink: 0,
            borderRadius: 'var(--radius-input)',
            backgroundColor: 'var(--color-surface-raised)',
            border: '1px solid var(--color-line-key)',
            fontSize: 'var(--text-mono-micro)',
            color: 'var(--color-ink-secondary)',
            textAlign: 'center',
          }}
        >
          {initialsOf(name)}
        </span>
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: 'var(--text-body-sm)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {name}
          </div>
          <div className="label">{role}</div>
        </div>
      </div>
      <form action={signOut}>
        <button
          type="submit"
          className="mt-2"
          style={{
            border: '1px solid var(--color-line-strong)',
            borderRadius: 'var(--radius-input)',
            color: 'var(--color-ink-secondary)',
            padding: '4px 10px',
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

/** First and last initial. One letter when there is only one word. */
function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = words[0]![0] ?? '';
  const last = words.length > 1 ? (words.at(-1)![0] ?? '') : '';
  return (first + last).toUpperCase();
}
