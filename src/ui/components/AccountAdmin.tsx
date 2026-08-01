'use client';

import { useActionState } from 'react';
import type { AccountsResult } from '@/app/accounts/actions';

/**
 * Granting and withdrawing access.
 *
 * Four forms rather than one, because they are four decisions and folding them
 * into a single submit would let a slip of the mouse change somebody's role
 * while intending to reset their password.
 *
 * **The password is shown once, and the screen says so.** No mail is sent by
 * this app, so the administrator carries it to the person. Pretending
 * otherwise — a "we've emailed them" that never arrives — is the failure that
 * costs an afternoon.
 */

type Action = (p: AccountsResult | null, f: FormData) => Promise<AccountsResult>;

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

  // Whichever action last spoke. Only one runs at a time, so this cannot
  // show two contradictory messages at once.
  const last = [created, changed, roled, reset].find(
    (r) => r.error !== undefined || r.ok !== undefined,
  );

  return (
    <div className="flex flex-col">
      <form action={create} className="flex flex-col gap-3" style={{ padding: '4px 0 18px' }}>
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
          The password is generated, shown once here, and cannot be recovered —
          only replaced. Nothing is emailed, so pass it on yourself.
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

      {/* The one thing on this screen that cannot be looked up again. */}
      {[created, reset].map((r, i) =>
        r.password === undefined ? null : (
          <div
            key={i}
            style={{
              padding: 14,
              borderRadius: 'var(--radius-control)',
              border: '1px solid var(--color-copper)',
              backgroundColor: 'var(--color-copper-wash)',
              marginBottom: 12,
            }}
          >
            <div className="label">{r.ok} Shown once</div>
            <div className="numeric mt-2" style={{ fontSize: 15, userSelect: 'all' }}>
              {r.email} · {r.password}
            </div>
            <p className="mt-2" style={note}>
              Copy it now. Leaving this page loses it, and the only way back is
              to reset the password again.
            </p>
          </div>
        ),
      )}

      {last?.ok === undefined || last.password !== undefined ? null : (
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
          className="flex items-center gap-3"
          style={{
            padding: '8px 0',
            borderBottom: '1px solid var(--color-line-hairline)',
            opacity: r.disabled ? 0.55 : 1,
          }}
        >
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
          <form action={reRole} style={{ width: 200 }}>
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
            <form action={doReset}>
              <input type="hidden" name="id" value={r.id} />
              <button
                type="submit"
                disabled={resetting}
                style={{ fontSize: 11.5, color: 'var(--color-ink-secondary)' }}
                title="Generate a new password, shown once"
              >
                Reset password
              </button>
            </form>
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
              <form action={change}>
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
