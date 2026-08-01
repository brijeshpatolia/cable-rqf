'use server';

import { revalidatePath } from 'next/cache';
import { session } from '@/infra/auth/session';
import { accountStore } from '@/infra/repositories';
import {
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
  /**
   * The generated password, returned exactly once and never stored in
   * plaintext. It exists in this object for one render and nowhere else.
   */
  readonly password?: string;
  readonly email?: string;
  /** Echoed back so a refusal does not cost the administrator their typing. */
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

  const existing = await accountStore.list();
  const plan = planNewAccount(
    gate.actor,
    { email, name, role },
    new Set(existing.map((a) => a.email)),
  );
  if (!plan.ok) return { error: plan.error.message, sent };

  const { password } = await accountStore.create(plan.value);
  revalidatePath('/accounts');

  /*
    The password comes back rather than being emailed, because this app sends
    no mail. Said plainly on the screen: it is shown once and cannot be
    recovered, only replaced.
  */
  return {
    ok: `${plan.value.name} can now sign in.`,
    password,
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

  const { password } = await accountStore.resetPassword(found.account.id);
  return {
    ok: `New password for ${found.account.name}.`,
    password,
    email: found.account.email,
  };
}
