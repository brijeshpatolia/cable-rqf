'use server';

import { revalidatePath } from 'next/cache';
import { session } from '@/infra/auth/session';
import { accountStore } from '@/infra/repositories';
import {
  checkPassword,
  planAccessChange,
  planNewAccount,
  planRoleChange,
  type AccountView,
} from '@/modules/accounts';
import { authorise, type Role } from '@/modules/auth';

/**
 * The write path for accounts.
 *
 * Thin adapters, exactly as elsewhere: check authority, read the form, ask the
 * pure module what the change *is*, hand the plan to the store. Nothing here
 * decides anything, which is what keeps the rules testable without a browser.
 *
 * **Authority is checked here and not only on the page.** A Server Action is a
 * public endpoint — the screen hiding a button is a courtesy to the person
 * using it, not a control on anybody who declines to use the screen. That
 * matters more on this file than any other: these actions grant access.
 */

export interface AccountsResult {
  readonly error?: string;
  readonly ok?: string;
  readonly email?: string;
  /**
   * Echoed back so a refusal does not cost the administrator their typing.
   *
   * The password is deliberately absent: a rejected form should not send it
   * back down the wire and into the page a second time. Retyping eight
   * characters is cheaper than that.
   */
  readonly sent?: { readonly email: string; readonly name: string; readonly role: string };
}

const ROLES: readonly Role[] = ['admin', 'rateOwner', 'engineer', 'viewer'];

function asRole(raw: string): Role | null {
  return ROLES.includes(raw as Role) ? (raw as Role) : null;
}

export async function createAccount(
  _previous: AccountsResult | null,
  form: FormData,
): Promise<AccountsResult> {
  const actor = await session.currentActor();
  const gate = authorise(actor, 'account.manage');
  if (!gate.ok) return { error: gate.failure.message };

  const email = String(form.get('email') ?? '');
  const name = String(form.get('name') ?? '');
  const raw = String(form.get('role') ?? '');
  const sent = { email, name, role: raw };

  const role = asRole(raw);
  if (role === null) return { error: `"${raw}" is not a role.`, sent };

  const password = checkPassword(String(form.get('password') ?? ''));
  if (!password.ok) return { error: password.error.message, sent };

  const existing = await accountStore.list();
  const plan = planNewAccount(
    gate.actor,
    { email, name, role },
    new Set(existing.map((a) => a.email)),
  );
  if (!plan.ok) return { error: plan.error.message, sent };

  await accountStore.create(plan.value, password.value);
  revalidatePath('/accounts');

  /*
    The password is not echoed back. The administrator chose it, so they
    already know it — and this app sends no mail, so telling them is not this
    screen's job either way.
  */
  return {
    ok: `${plan.value.name} can sign in with the password you set.`,
    email: plan.value.email,
  };
}

/** Shared by the two actions that act on an existing account. */
async function target(
  id: string,
): Promise<
  | { readonly ok: true; readonly all: readonly AccountView[]; readonly account: AccountView }
  | { readonly ok: false; readonly error: string }
> {
  const all = await accountStore.list();
  const account = all.find((a) => a.id === id);
  if (account === undefined) return { ok: false, error: 'That account no longer exists.' };
  return { ok: true, all, account };
}

export async function setAccess(
  _previous: AccountsResult | null,
  form: FormData,
): Promise<AccountsResult> {
  const actor = await session.currentActor();
  const gate = authorise(actor, 'account.manage');
  if (!gate.ok) return { error: gate.failure.message };

  const found = await target(String(form.get('id') ?? ''));
  if (!found.ok) return { error: found.error };

  const disabled = String(form.get('disabled') ?? '') === 'true';
  const plan = planAccessChange(gate.actor, found.account, disabled, found.all);
  if (!plan.ok) return { error: plan.error.message };

  await accountStore.setAccess(plan.value);
  revalidatePath('/accounts');
  return {
    ok: `${found.account.name} ${disabled ? 'can no longer sign in' : 'can sign in again'}.`,
  };
}

export async function setRole(
  _previous: AccountsResult | null,
  form: FormData,
): Promise<AccountsResult> {
  const actor = await session.currentActor();
  const gate = authorise(actor, 'account.manage');
  if (!gate.ok) return { error: gate.failure.message };

  const found = await target(String(form.get('id') ?? ''));
  if (!found.ok) return { error: found.error };

  const role = asRole(String(form.get('role') ?? ''));
  if (role === null) return { error: 'That is not a role.' };
  if (role === found.account.role) return {};

  const plan = planRoleChange(gate.actor, found.account, role, found.all);
  if (!plan.ok) return { error: plan.error.message };

  await accountStore.setRole(plan.value);
  revalidatePath('/accounts');
  return { ok: `${found.account.name} is now a ${role === 'admin' ? 'n administrator' : role}.` };
}

export async function resetPassword(
  _previous: AccountsResult | null,
  form: FormData,
): Promise<AccountsResult> {
  const actor = await session.currentActor();
  const gate = authorise(actor, 'account.manage');
  if (!gate.ok) return { error: gate.failure.message };

  const found = await target(String(form.get('id') ?? ''));
  if (!found.ok) return { error: found.error };

  const password = checkPassword(String(form.get('password') ?? ''));
  if (!password.ok) return { error: password.error.message };

  await accountStore.resetPassword(found.account.id, password.value);
  /*
    No audit row. The trail records what somebody may do — roles, access,
    account creation — and a password change alters none of that. Writing one
    would put a row beside every genuine authority change that is only ever
    "somebody forgot theirs", which is noise in the one place that should not
    have any.
  */
  return { ok: `${found.account.name} can now sign in with the new password.` };
}
