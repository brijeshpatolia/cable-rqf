import { describe, expect, it } from 'vitest';
import { type Actor, type Capability, type Role, authorise, can } from './index';

const actor = (role: Role): Actor => ({
  id: 'u1',
  email: 'someone@example.com',
  name: 'Someone',
  role,
});

const ROLES: readonly Role[] = ['rateOwner', 'engineer', 'viewer'];
const CAPABILITIES: readonly Capability[] = [
  'rate.edit',
  'lme.enter',
  'line.override',
  'quote.approve',
  'read',
];

/**
 * The authority model, asserted as a whole table rather than case by case.
 *
 * Every (role × capability) pair is stated explicitly, so a change to the
 * grants shows up here as a diff of what someone can now do — which is the
 * only form in which a permission change is reviewable.
 */
const EXPECTED: Readonly<Record<Role, Readonly<Record<Capability, boolean>>>> = {
  rateOwner: {
    'rate.edit': true,
    'lme.enter': true,
    'line.override': false,
    'quote.approve': false,
    read: true,
  },
  engineer: {
    'rate.edit': false,
    'lme.enter': false,
    'line.override': true,
    'quote.approve': true,
    read: true,
  },
  viewer: {
    'rate.edit': false,
    'lme.enter': false,
    'line.override': false,
    'quote.approve': false,
    read: true,
  },
};

describe('authority', () => {
  for (const role of ROLES) {
    for (const capability of CAPABILITIES) {
      const want = EXPECTED[role][capability];
      it(`${role} ${want ? 'may' : 'may NOT'} ${capability}`, () => {
        expect(can(actor(role), capability)).toBe(want);
      });
    }
  }

  it('keeps rate editing and approval in different hands', () => {
    // The spec's whole reason for separating the roles: the person who sets
    // the copper price must not also be the one who signs off the quote
    // struck on it.
    expect(can(actor('rateOwner'), 'quote.approve')).toBe(false);
    expect(can(actor('engineer'), 'rate.edit')).toBe(false);
  });

  it('grants nothing at all to an absent actor', () => {
    for (const capability of CAPABILITIES) {
      expect(can(null, capability)).toBe(false);
    }
  });
});

describe('authorise', () => {
  it('lets a permitted actor through and hands back the actor', () => {
    const result = authorise(actor('rateOwner'), 'rate.edit');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.actor.email).toBe('someone@example.com');
  });

  it('separates "not signed in" from "not allowed"', () => {
    const absent = authorise(null, 'rate.edit');
    const wrongRole = authorise(actor('viewer'), 'rate.edit');

    expect(absent.ok).toBe(false);
    expect(wrongRole.ok).toBe(false);
    if (!absent.ok) expect(absent.failure.kind).toBe('UNAUTHENTICATED');
    if (!wrongRole.ok) expect(wrongRole.failure.kind).toBe('FORBIDDEN');
  });

  it('says who cannot do what, in words', () => {
    const result = authorise(actor('engineer'), 'rate.edit');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.message).toBe('An engineer cannot edit rates.');
    }
  });
});
