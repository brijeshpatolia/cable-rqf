import type { Actor, Role } from '@/modules/auth';

/**
 * Who may use this app, and as what.
 *
 * Accounts were made with a command-line script, which was the right amount of
 * process for the first ten and the wrong amount the moment somebody who does
 * not have the repository checked out needs to grant a colleague access. This
 * is the same operation with the same guarantees, behind a screen.
 *
 * **Pure.** No database, no hashing, no Prisma. It decides whether a request is
 * allowed and well-formed, and hands back a plan plus the audit row that has to
 * be written with it. `infra` performs it. The point of the split is that every
 * rule below is testable without a database, and none of them can be skipped by
 * a caller that forgets — an unperformed plan changes nothing.
 *
 * **Nothing is ever deleted.** Revoking access disables an account, which keeps
 * the row, the name, and every audit event that account ever wrote. Deleting a
 * user would either orphan or erase their history, and an audit trail with
 * people missing from it is not an audit trail.
 */

export type AccountErrorKind =
  | 'FORBIDDEN'
  | 'EMAIL_INVALID'
  | 'EMAIL_TAKEN'
  | 'NAME_REQUIRED'
  | 'PASSWORD_TOO_SHORT'
  | 'SELF_DISABLE'
  | 'SELF_DEMOTE'
  | 'LAST_ADMIN';

export interface AccountError {
  readonly kind: AccountErrorKind;
  readonly message: string;
}

export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: AccountError };

const err = (kind: AccountErrorKind, message: string): Result<never> => ({
  ok: false,
  error: { kind, message },
});

/** What the screen shows for each account. No password material, ever. */
export interface AccountView {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly role: Role;
  readonly disabledAt: Date | null;
  readonly createdAt: Date;
}

export interface AuditRow {
  readonly actorId: string;
  readonly actorEmail: string;
  readonly entity: string;
  readonly field: string;
  readonly previous: string;
  readonly next: string;
  readonly reason: string;
}

export interface NewAccount {
  readonly email: string;
  readonly name: string;
  readonly role: Role;
  readonly audit: AuditRow;
}

/**
 * The one rule kept on a password the administrator chooses.
 *
 * Passwords used to be generated here, which made them strong and made nobody
 * responsible for remembering them. Chosen ones are weaker on average and the
 * administrator ends up knowing everybody's — both true, both accepted, and
 * neither is a reason for this module to start refusing what somebody with
 * authority typed on purpose.
 *
 * What it will not accept is a length that is obviously an accident. Eight is
 * low enough that no deliberate password fails it and high enough that a
 * stray keystroke does. A pattern demanding a capital and a digit would only
 * teach people to end everything in `1!`.
 */
export const MIN_PASSWORD = 8;

export function checkPassword(raw: string): Result<string> {
  if (raw.length < MIN_PASSWORD) {
    return err(
      'PASSWORD_TOO_SHORT',
      `A password needs at least ${MIN_PASSWORD} characters. This one has ${raw.length}.`,
    );
  }
  return { ok: true, value: raw };
}

/**
 * Deliberately permissive, and it should be.
 *
 * The strict thing to do is a long pattern that rejects addresses which are
 * perfectly legal — apostrophes, plus-addressing, new top-level domains — and
 * every one of those rejections is a person who cannot be given access by a
 * screen that believes it knows better. The real check on an address is
 * whether mail reaches it, which this cannot know. So it rules out what is
 * certainly not an address and lets a person be responsible for the rest.
 */
const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

/** Stored lowercase so `S.Patolia@…` and `s.patolia@…` cannot both exist. */
export function normaliseEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Grant somebody access.
 *
 * The password is not decided here. `infra` generates one and hashes it, so no
 * plaintext ever passes through a module that something might one day log.
 */
export function planNewAccount(
  actor: Actor | null,
  request: { readonly email: string; readonly name: string; readonly role: Role },
  existingEmails: ReadonlySet<string>,
): Result<NewAccount> {
  if (actor === null || actor.role !== 'admin') {
    return err('FORBIDDEN', 'Only an administrator may create an account.');
  }

  const email = normaliseEmail(request.email);
  const name = request.name.trim();

  if (!EMAIL.test(email)) {
    return err('EMAIL_INVALID', `"${request.email.trim()}" is not an email address.`);
  }
  if (name === '') {
    return err(
      'NAME_REQUIRED',
      'A name is required — it is what the audit trail shows beside every change.',
    );
  }
  if (existingEmails.has(email)) {
    return err(
      'EMAIL_TAKEN',
      `${email} already has an account. Change its role or re-enable it rather than making a second one.`,
    );
  }

  return {
    ok: true,
    value: {
      email,
      name,
      role: request.role,
      audit: {
        actorId: actor.id,
        actorEmail: actor.email,
        entity: `app_user:${email}`,
        field: 'account',
        previous: '—',
        next: request.role,
        reason: `Account created by ${actor.name}`,
      },
    },
  };
}

export interface AccessChange {
  readonly id: string;
  readonly disabled: boolean;
  readonly audit: AuditRow;
}

/**
 * Take access away, or give it back.
 *
 * Refuses to disable the account making the request. Not because it would
 * break anything — the session survives until it is next checked — but because
 * the person doing it would then be locked out of the only screen that could
 * undo it, and would need somebody with a database console to get back in.
 */
export function planAccessChange(
  actor: Actor | null,
  target: AccountView,
  disabled: boolean,
  allAccounts: readonly AccountView[],
): Result<AccessChange> {
  if (actor === null || actor.role !== 'admin') {
    return err('FORBIDDEN', 'Only an administrator may change access.');
  }
  if (disabled && target.id === actor.id) {
    return err(
      'SELF_DISABLE',
      'You cannot disable your own account — you would lock yourself out of the screen that undoes it.',
    );
  }
  if (disabled && target.role === 'admin' && lastActiveAdmin(target, allAccounts)) {
    return err(
      'LAST_ADMIN',
      'This is the only administrator left. Promote somebody else first, or nobody can manage accounts.',
    );
  }

  return {
    ok: true,
    value: {
      id: target.id,
      disabled,
      audit: {
        actorId: actor.id,
        actorEmail: actor.email,
        entity: `app_user:${target.email}`,
        field: 'access',
        previous: target.disabledAt === null ? 'active' : 'disabled',
        next: disabled ? 'disabled' : 'active',
        reason: `Access ${disabled ? 'withdrawn' : 'restored'} by ${actor.name}`,
      },
    },
  };
}

export interface RoleChange {
  readonly id: string;
  readonly role: Role;
  readonly audit: AuditRow;
}

/**
 * Change what somebody may do.
 *
 * Two refusals, and they are the same refusal wearing different clothes: an
 * administrator may not remove their own administrator rights, and the last
 * remaining administrator may not be demoted. Both leave an app nobody can
 * manage accounts in, recoverable only from a database console.
 */
export function planRoleChange(
  actor: Actor | null,
  target: AccountView,
  role: Role,
  allAccounts: readonly AccountView[],
): Result<RoleChange> {
  if (actor === null || actor.role !== 'admin') {
    return err('FORBIDDEN', 'Only an administrator may change a role.');
  }
  if (target.id === actor.id && role !== 'admin') {
    return err(
      'SELF_DEMOTE',
      'You cannot remove your own administrator rights. Ask another administrator to do it.',
    );
  }
  if (target.role === 'admin' && role !== 'admin' && lastActiveAdmin(target, allAccounts)) {
    return err(
      'LAST_ADMIN',
      'This is the only administrator left. Promote somebody else first.',
    );
  }

  return {
    ok: true,
    value: {
      id: target.id,
      role,
      audit: {
        actorId: actor.id,
        actorEmail: actor.email,
        entity: `app_user:${target.email}`,
        field: 'role',
        previous: target.role,
        next: role,
        reason: `Role changed by ${actor.name}`,
      },
    },
  };
}

/** Whether this account is the only administrator still able to sign in. */
function lastActiveAdmin(
  target: AccountView,
  all: readonly AccountView[],
): boolean {
  return (
    all.filter((a) => a.role === 'admin' && a.disabledAt === null && a.id !== target.id)
      .length === 0
  );
}
