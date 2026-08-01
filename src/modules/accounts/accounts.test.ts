import { describe, expect, it } from 'vitest';
import type { Actor, Role } from '@/modules/auth';
import {
  normaliseEmail,
  planAccessChange,
  planNewAccount,
  planRoleChange,
  type AccountView,
} from './index';

const actor = (role: Role, id = 'admin-1'): Actor => ({
  id,
  email: `${id}@nuhas.example`,
  name: 'Sudhir Patolia',
  role,
});

const account = (over: Partial<AccountView> = {}): AccountView => ({
  id: 'u-1',
  email: 'engineer@nuhas.example',
  name: 'An Engineer',
  role: 'engineer',
  disabledAt: null,
  createdAt: new Date('2026-07-01T00:00:00Z'),
  ...over,
});

const ADMIN = actor('admin');
const NONE = new Set<string>();

describe('creating an account', () => {
  it('refuses every role but admin, including the rate owner', () => {
    /*
      A Rate Owner who could mint accounts could mint themselves a second one
      with a different role, which would make every other grant in the app
      advisory.
    */
    for (const role of ['rateOwner', 'engineer', 'viewer'] as const) {
      const r = planNewAccount(
        actor(role),
        { email: 'new@nuhas.example', name: 'New', role: 'engineer' },
        NONE,
      );
      expect(r.ok, role).toBe(false);
      if (!r.ok) expect(r.error.kind).toBe('FORBIDDEN');
    }
  });

  it('refuses an anonymous request', () => {
    const r = planNewAccount(null, { email: 'a@b.com', name: 'A', role: 'admin' }, NONE);
    expect(r.ok).toBe(false);
  });

  it('lowercases the address, so one person cannot hold two accounts', () => {
    const r = planNewAccount(
      ADMIN,
      { email: '  S.Patolia@Nuhas.Example  ', name: '  Sudhir  ', role: 'admin' },
      NONE,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.email).toBe('s.patolia@nuhas.example');
    expect(r.value.name).toBe('Sudhir');
  });

  it('rejects what is certainly not an address', () => {
    for (const bad of ['sudhir patolia', 'sudhir@', '@nuhas.example', 'sudhir@local', '']) {
      const r = planNewAccount(ADMIN, { email: bad, name: 'X', role: 'engineer' }, NONE);
      expect(r.ok, bad).toBe(false);
      if (!r.ok) expect(r.error.kind).toBe('EMAIL_INVALID');
    }
  });

  it('accepts addresses a stricter pattern would wrongly turn away', () => {
    // Each of these is legal, and rejecting one is a person who cannot be
    // given access by a screen that thinks it knows better.
    for (const good of [
      'sudhir+quotes@nuhasoman.com',
      "o'brien@example.co.uk",
      'a@b.engineering',
    ]) {
      const r = planNewAccount(ADMIN, { email: good, name: 'X', role: 'engineer' }, NONE);
      expect(r.ok, good).toBe(true);
    }
  });

  it('requires a name, because the audit trail shows it beside every change', () => {
    const r = planNewAccount(ADMIN, { email: 'a@b.com', name: '   ', role: 'engineer' }, NONE);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('NAME_REQUIRED');
  });

  it('refuses a duplicate, whatever case it is typed in', () => {
    const r = planNewAccount(
      ADMIN,
      { email: 'Taken@Nuhas.Example', name: 'X', role: 'engineer' },
      new Set(['taken@nuhas.example']),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('EMAIL_TAKEN');
  });

  it('names who did it in the audit row, not just that it happened', () => {
    const r = planNewAccount(ADMIN, { email: 'a@b.com', name: 'X', role: 'engineer' }, NONE);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.audit.entity).toBe('app_user:a@b.com');
    expect(r.value.audit.previous).toBe('—');
    expect(r.value.audit.next).toBe('engineer');
    expect(r.value.audit.reason).toBe('Account created by Sudhir Patolia');
  });
});

describe('withdrawing and restoring access', () => {
  it('will not let an administrator disable themselves', () => {
    // They would then be locked out of the only screen that undoes it.
    const self = account({ id: 'admin-1', role: 'admin' });
    const r = planAccessChange(ADMIN, self, true, [self]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('SELF_DISABLE');
  });

  it('will not disable the last administrator', () => {
    const other = account({ id: 'admin-2', email: 'other@x.com', role: 'admin' });
    const r = planAccessChange(ADMIN, other, true, [other]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('LAST_ADMIN');
  });

  it('allows it once a second administrator can still sign in', () => {
    const other = account({ id: 'admin-2', email: 'other@x.com', role: 'admin' });
    const me = account({ id: 'admin-1', email: 'admin-1@nuhas.example', role: 'admin' });
    const r = planAccessChange(ADMIN, other, true, [other, me]);
    expect(r.ok).toBe(true);
  });

  it('does not count a disabled administrator as cover', () => {
    // An admin who cannot sign in cannot rescue anybody.
    const other = account({ id: 'admin-2', email: 'other@x.com', role: 'admin' });
    const sleeping = account({
      id: 'admin-3',
      email: 'sleeping@x.com',
      role: 'admin',
      disabledAt: new Date('2026-07-01T00:00:00Z'),
    });
    const r = planAccessChange(ADMIN, other, true, [other, sleeping]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('LAST_ADMIN');
  });

  it('always allows restoring, including the last administrator', () => {
    const off = account({ role: 'admin', disabledAt: new Date('2026-07-01T00:00:00Z') });
    const r = planAccessChange(ADMIN, off, false, [off]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.audit.previous).toBe('disabled');
    expect(r.value.audit.next).toBe('active');
  });

  it('records what access was before, not only what it became', () => {
    const other = account({ id: 'u-9' });
    const me = account({ id: 'admin-1', role: 'admin' });
    const r = planAccessChange(ADMIN, other, true, [other, me]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.audit.previous).toBe('active');
    expect(r.value.audit.reason).toBe('Access withdrawn by Sudhir Patolia');
  });
});

describe('changing a role', () => {
  it('will not let an administrator demote themselves', () => {
    const self = account({ id: 'admin-1', role: 'admin' });
    const r = planRoleChange(ADMIN, self, 'engineer', [self]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('SELF_DEMOTE');
  });

  it('will not demote the last administrator', () => {
    const other = account({ id: 'admin-2', email: 'other@x.com', role: 'admin' });
    const r = planRoleChange(ADMIN, other, 'rateOwner', [other]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('LAST_ADMIN');
  });

  it('promotes freely — there is no such thing as too many to recover from', () => {
    const r = planRoleChange(ADMIN, account(), 'admin', [account()]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.audit.field).toBe('role');
    expect(r.value.audit.previous).toBe('engineer');
    expect(r.value.audit.next).toBe('admin');
  });

  it('refuses every role but admin', () => {
    const r = planRoleChange(actor('rateOwner'), account(), 'admin', [account()]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('FORBIDDEN');
  });
});

describe('normaliseEmail', () => {
  it('trims and lowercases', () => {
    expect(normaliseEmail('  A@B.COM ')).toBe('a@b.com');
  });
});
