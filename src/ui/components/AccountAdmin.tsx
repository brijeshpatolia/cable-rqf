'use client';

import { useActionState, useState } from 'react';
import type { AccountsResult } from '@/app/accounts/actions';

/**
 * Granting and withdrawing access.
 *
 * Four forms rather than one, because they are four decisions and folding them
 * into a single submit would let a slip of the mouse change somebody's role
 * while intending to reset their password.
 *
 * **The administrator types the password.** It used to be generated and shown
 * once, which made it strong and made nobody responsible for it: a random
 * string has to be written down somewhere before it can be told to anybody,
 * and that somewhere is usually worse than the person's memory. Typed, it can
 * be said out loud across a desk and changed in ten seconds if it leaks.
 *
 * The costs are real and are not hidden: chosen passwords are weaker on
 * average, and the administrator knows everybody's. The screen says the second
 * one out loud, because a person handed a password they did not choose should
 * know who else can read it.
 */

type Action = (p: AccountsResult | null, f: FormData) => Promise<AccountsResult>;

/** Which form last submitted, so the right result is the one on screen. */
type Speaker = 'create' | 'access' | 'role' | 'reset';

export interface AccountRow {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly role: string;
  readonly roleLabel: string;
  readonly disabled: boolean;
  readonly created: string;
  /** True for the signed-in administrator's own row. */
  readonly isSelf: boolean;
}

const ROLES: readonly { readonly value: string; readonly label: string; readonly note: string }[] =
  [
    { value: 'engineer', label: 'Engineer', note: 'Reviews enquiries, overrides lines, approves quotes' },
    { value: 'rateOwner', label: 'Rate Owner', note: 'Edits rates, the catalogue, the dictionary' },
    { value: 'viewer', label: 'Viewer', note: 'Reads everything, changes nothing' },
    { value: 'admin', label: 'Administrator', note: 'Everything, including accounts' },
  ];

const input: React.CSSProperties = {
  height: 32,
  padding: '0 10px',
  borderRadius: 'var(--radius-input)',
  border: '1px solid var(--color-line-strong)',
  backgroundColor: 'var(--color-surface-base)',
  fontSize: 13,
};

export function AccountAdmin({
  rows,
  createAction,
  accessAction,
  roleAction,
  resetAction,
}: {
  readonly rows: readonly AccountRow[];
  readonly createAction: Action;
  readonly accessAction: Action;
  readonly roleAction: Action;
  readonly resetAction: Action;
}) {
  const [created, create, creating] = useActionState(createAction, {});
  const [changed, change, changing] = useActionState(accessAction, {});
  const [roled, reRole, reRoling] = useActionState(roleAction, {});
  const [reset, doReset, resetting] = useActionState(resetAction, {});
  /** Which row has its password field open. One at a time, or none. */
  const [open, setOpen] = useState<string | null>(null);

  /*
    Which of the four actions to show the message from.

    This used to be "the first of the four that has anything to say", which
    reads correctly right up until the second action of a session: create an
    account, then reset somebody's password, and the screen still congratulates
    you on the account. React does not say which state changed, so the form
    that was submitted records itself on the way out. `onSubmit` is safe here —
    it fires before the action and unmounts nothing.
  */
  const [speaker, setSpeaker] = useState<Speaker>('create');
  const last = { create: created, access: changed, role: roled, reset }[speaker];

  return (
    <div className="flex flex-col">
      <form
        action={create}
        onSubmit={() => setSpeaker('create')}
        className="flex flex-col gap-3"
        style={{ padding: '4px 0 18px' }}
      >
        <span className="label">Grant somebody access</span>
        <div className="flex flex-wrap gap-3">
          <label className="flex flex-col gap-1" style={{ flex: '1 1 220px' }}>
            <span className="label">Name</span>
            <input
              name="name"
              required
              defaultValue={created.sent?.name ?? ''}
              placeholder="Sudhir Patolia"
              style={input}
            />
          </label>
          <label className="flex flex-col gap-1" style={{ flex: '1 1 260px' }}>
            <span className="label">Email</span>
            <input
              name="email"
              type="email"
              required
              defaultValue={created.sent?.email ?? ''}
              placeholder="sudhir@example.com"
              className="numeric"
              style={input}
            />
          </label>
          <label className="flex flex-col gap-1" style={{ flex: '1 1 190px' }}>
            <span className="label">Password</span>
            <input
              name="password"
              type="text"
              required
              minLength={8}
              placeholder="at least 8 characters"
              className="numeric"
              style={input}
            />
          </label>
          <label className="flex flex-col gap-1" style={{ width: 190 }}>
            <span className="label">Role</span>
            <select
              name="role"
              defaultValue={created.sent?.role ?? 'engineer'}
              style={input}
            >
              {ROLES.map((r) => (
                <option key={r.value} value={r.value} title={r.note}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            disabled={creating}
            className="self-end"
            style={{
              height: 32,
              padding: '0 16px',
              borderRadius: 'var(--radius-control)',
              backgroundColor: 'var(--color-copper)',
              color: 'var(--color-ink-on-copper)',
              fontSize: 13,
              fontWeight: 550,
            }}
          >
            {creating ? 'Creating…' : 'Create account'}
          </button>
        </div>
        <p style={note}>
          You choose the password and pass it on yourself — nothing is emailed.
          It is stored hashed and cannot be read back by anyone, including you;
          if it is forgotten, set a new one rather than recovering the old.
        </p>
      </form>

      {last?.error === undefined ? null : (
        <p
          role="alert"
          style={{
            padding: '10px 12px',
            borderRadius: 'var(--radius-control)',
            border: '1px solid var(--color-status-manual)',
            backgroundColor: 'var(--color-status-manual-wash)',
            color: 'var(--color-ink-primary)',
            fontSize: 13,
          }}
        >
          {last.error}
        </p>
      )}

      {last?.ok === undefined ? null : (
        <p className="mb-3" style={{ ...note, color: 'var(--color-status-exact)' }}>
          {last.ok}
        </p>
      )}

      <div
        className="label flex items-baseline gap-3"
        style={{ padding: '8px 0 6px', borderBottom: '1px solid var(--color-line-strong)' }}
      >
        <span className="flex-1">Person</span>
        <span style={{ width: 200 }}>Role</span>
        <span style={{ width: 110 }}>Since</span>
        <span style={{ width: 170, textAlign: 'right' }}>Access</span>
      </div>

      {rows.map((r) => (
        <div
          key={r.id}
          // Names the row it is. Useful for anything driving this screen, and
          // the email is already on show two lines below.
          data-account={r.email}
          style={{
            borderBottom: '1px solid var(--color-line-hairline)',
            opacity: r.disabled ? 0.55 : 1,
          }}
        >
        <div className="flex items-center gap-3" style={{ padding: '8px 0' }}>
          <span className="min-w-0 flex-1 flex flex-col" style={{ gap: 1 }}>
            <span>
              {r.name}
              {r.isSelf ? (
                <span
                  className="label"
                  style={{ marginLeft: 8, color: 'var(--color-ink-tertiary)' }}
                >
                  you
                </span>
              ) : null}
            </span>
            <span
              className="numeric"
              style={{ color: 'var(--color-ink-tertiary)', fontSize: 'var(--text-micro)' }}
            >
              {r.email}
            </span>
          </span>

          {/*
            A role changes on selection rather than behind a Save. There is no
            draft state worth keeping here, and a Save that has to be found is
            how a half-made change gets left on screen and believed.
          */}
          <form action={reRole} onSubmit={() => setSpeaker('role')} style={{ width: 200 }}>
            <input type="hidden" name="id" value={r.id} />
            <select
              name="role"
              defaultValue={r.role}
              disabled={reRoling || r.disabled}
              onChange={(e) => e.currentTarget.form?.requestSubmit()}
              style={{ ...input, width: '100%' }}
              title={r.disabled ? 'Restore access before changing the role' : undefined}
            >
              {ROLES.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </form>

          <span
            className="numeric"
            style={{ width: 110, color: 'var(--color-ink-tertiary)', fontSize: 'var(--text-micro)' }}
          >
            {r.created}
          </span>

          <span className="flex items-center justify-end gap-2" style={{ width: 170 }}>
            {/*
              Opens a field rather than acting on the click. A single button
              that silently replaced somebody's password would be the most
              destructive control on the screen and the easiest to hit by
              accident, and there would be nothing to undo it with — the old
              password cannot be read back.
            */}
            <button
              type="button"
              onClick={() => setOpen(open === r.id ? null : r.id)}
              style={{ fontSize: 11.5, color: 'var(--color-ink-secondary)' }}
            >
              {open === r.id ? 'Cancel' : 'Set password'}
            </button>
            {/*
              Your own row says why instead of offering a button that looks
              live and is not. The app's rule is that a disabled action states
              its condition, and a greyed-out control with the reason hidden
              in a `title` states it only to somebody already hovering over it
              wondering what is wrong.
            */}
            {r.isSelf && !r.disabled ? (
              <span
                style={{ fontSize: 11.5, color: 'var(--color-ink-tertiary)' }}
                title="Withdrawing your own access would lock you out of the screen that restores it."
              >
                Yours to keep
              </span>
            ) : (
              <form action={change} onSubmit={() => setSpeaker('access')}>
                <input type="hidden" name="id" value={r.id} />
                <input type="hidden" name="disabled" value={r.disabled ? 'false' : 'true'} />
                <button
                  type="submit"
                  disabled={changing}
                  style={{
                    fontSize: 11.5,
                    color: r.disabled
                      ? 'var(--color-status-exact)'
                      : 'var(--color-status-manual)',
                  }}
                >
                  {r.disabled ? 'Restore' : 'Withdraw'}
                </button>
              </form>
            )}
          </span>
          </div>

          {/*
            Rendered under the row it belongs to, so there is no doubt whose
            password is about to change. Only one is ever open.
          */}
          {/*
            The field is not closed on submit. Unmounting a form while its
            Server Action is in flight is a race with nothing to gain, and
            leaving it open means the confirmation appears beside the row it
            belongs to rather than after the thing it referred to has gone.
          */}
          {open === r.id ? (
            <form
              action={doReset}
              onSubmit={() => setSpeaker('reset')}
              className="flex items-end gap-3"
              style={{ padding: '0 0 12px' }}
            >
              <input type="hidden" name="id" value={r.id} />
              <label className="flex flex-col gap-1" style={{ flex: '0 1 260px' }}>
                <span className="label">New password for {r.name}</span>
                <input
                  name="password"
                  type="text"
                  required
                  autoFocus
                  minLength={8}
                  placeholder="at least 8 characters"
                  className="numeric"
                  style={input}
                />
              </label>
              <button
                type="submit"
                disabled={resetting}
                style={{
                  height: 32,
                  padding: '0 14px',
                  borderRadius: 'var(--radius-control)',
                  border: '1px solid var(--color-line-strong)',
                  fontSize: 12.5,
                }}
              >
                {resetting ? 'Setting…' : 'Set it'}
              </button>
              <span style={{ ...note, flex: 1, marginBottom: 8 }}>
                Replaces it immediately. They stay signed in wherever they
                already are — withdraw access if that is the intent.
              </span>
            </form>
          ) : null}
        </div>
      ))}
    </div>
  );
}

const note: React.CSSProperties = {
  color: 'var(--color-ink-secondary)',
  fontSize: 'var(--text-micro)',
  lineHeight: 'var(--text-micro--line-height)',
  maxWidth: 640,
};
