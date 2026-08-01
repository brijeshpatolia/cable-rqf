import { redirect } from 'next/navigation';
import { formatDate } from '@/core/format';
import { session } from '@/infra/auth/session';
import { accountStore } from '@/infra/repositories';
import { can, roleLabel } from '@/modules/auth';
import { AccountAdmin } from '@/ui/components/AccountAdmin';
import { Panel } from '@/ui/components/Panel';
import { createAccount, resetPassword, setAccess, setRole } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Accounts — Cable Quoting' };

/**
 * Who may use this app, and as what.
 *
 * Accounts were made with a command-line script — the right amount of process
 * for the first ten, and the wrong amount the moment somebody who does not
 * have the repository checked out needs to give a colleague access. Same
 * operation, same guarantees, behind a screen.
 *
 * **Administrator only, checked here and again in every action.** The page
 * turning people away is a courtesy to whoever opens it by accident; the check
 * that matters is in the actions, because a Server Action is a public endpoint
 * and these ones grant access.
 *
 * Redirected rather than shown as a refusal: an engineer who reaches this by
 * a stale link wants the app, not a lecture about permissions.
 */
export default async function AccountsPage() {
  const actor = await session.currentActor();
  if (actor === null) redirect('/sign-in');
  if (!can(actor, 'account.manage')) redirect('/');

  const accounts = await accountStore.list();

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'var(--text-display-lg)',
            lineHeight: 'var(--text-display-lg--line-height)',
            letterSpacing: 'var(--text-display-lg--letter-spacing)',
            fontWeight: 500,
          }}
        >
          Accounts
        </h1>
        <p className="mt-2" style={{ color: 'var(--color-ink-secondary)', maxWidth: 660 }}>
          Everyone who may sign in, and what each of them may do. There is no
          self-signup: an account exists because an administrator made it, and
          the making of it is the first line of its own audit trail.
        </p>
        <p
          className="mt-2"
          style={{
            color: 'var(--color-ink-secondary)',
            fontSize: 'var(--text-micro)',
            lineHeight: 'var(--text-micro--line-height)',
            maxWidth: 660,
          }}
        >
          Access is withdrawn, never deleted. A person who leaves keeps their
          name on every rate they set and every quote they approved — a trail
          with people missing from it would not be one.
        </p>
      </header>

      <Panel title="People">
        <AccountAdmin
          rows={accounts.map((a) => ({
            id: a.id,
            email: a.email,
            name: a.name,
            role: a.role,
            roleLabel: roleLabel(a.role),
            disabled: a.disabledAt !== null,
            created: formatDate(a.createdAt),
            isSelf: a.id === actor.id,
          }))}
          createAction={createAccount}
          accessAction={setAccess}
          roleAction={setRole}
          resetAction={resetPassword}
        />
      </Panel>
    </div>
  );
}
