/**
 * Identity and authority.
 *
 * Pure: no knowledge of cookies, providers, or Next. `infra/auth` answers
 * "who is making this request"; this module answers "and what may they do".
 * That split is what lets sign-in move to Google or Microsoft later by adding
 * one adapter file.
 *
 * Actors are keyed by **email**. It is the one identifier every identity
 * provider agrees on, so switching provider means people sign in differently
 * and keep their id, their role, and every audit row they ever wrote. Roles
 * live in this system's database, never in the provider — who is a Rate Owner
 * stays Nuhas's decision, not their IT department's.
 */

export type Role = 'admin' | 'rateOwner' | 'engineer' | 'viewer';

export interface Actor {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly role: Role;
}

/**
 * What may be done, named by the action rather than by the screen.
 *
 * PROJECT_PLAN.md §2.4 makes rate editing and approval deliberately different
 * people: the person who sets the copper price is not the person who signs off
 * the quote struck on it.
 */
export type Capability =
  | 'rate.edit'
  | 'lme.enter'
  | 'line.override'
  | 'quote.approve'
  | 'account.manage'
  | 'read';

/**
 * The whole authority model, in one readable table.
 *
 * Exhaustive by construction: `Record<Role, ...>` means adding a role without
 * deciding its capabilities is a compile error, not a silent denial or — far
 * worse — a silent grant.
 */
const GRANTS: Readonly<Record<Role, readonly Capability[]>> = {
  /*
    Everything, including both halves of a separation the other roles keep.

    §2.4 splits rate editing from quote approval on purpose: the person who
    sets the copper price should not be the person who signs off the quote
    struck on it. That control assumes enough people to divide the work
    between, which a company of this size does not always have, and an
    administrator who cannot approve a quote at seven in the evening is a
    control that gets worked around rather than observed.

    So it is granted, and the cost is stated rather than hidden: an admin
    acting alone leaves no second pair of eyes on their own rate change. What
    survives is attribution — every rate, every approval and every account
    carries the name of whoever did it, permanently and unerasably, which is
    the half of the control that still works with one person.

    `account.manage` is admin-only and stays that way. A Rate Owner who could
    mint accounts could mint themselves a second one.
  */
  admin: [
    'rate.edit',
    'lme.enter',
    'line.override',
    'quote.approve',
    'account.manage',
    'read',
  ],
  rateOwner: ['rate.edit', 'lme.enter', 'read'],
  engineer: ['line.override', 'quote.approve', 'read'],
  viewer: ['read'],
};

/**
 * The role, in the words the screens already use.
 *
 * Worth naming rather than leaving as `rateOwner` on screen: controls are
 * hidden by role throughout the app, and a person who cannot see the button
 * deserves to know which of the two jobs they are doing rather than wondering
 * whether the screen is broken.
 */
const ROLE_LABELS: Readonly<Record<Role, string>> = {
  admin: 'Administrator',
  rateOwner: 'Rate Owner',
  engineer: 'Engineer',
  viewer: 'Viewer',
};

export function roleLabel(role: Role): string {
  return ROLE_LABELS[role];
}

export function can(actor: Actor | null, capability: Capability): boolean {
  if (actor === null) return false;
  return GRANTS[actor.role].includes(capability);
}

export type AuthFailure =
  | { readonly kind: 'UNAUTHENTICATED'; readonly message: string }
  | { readonly kind: 'FORBIDDEN'; readonly message: string };

/**
 * The gate every write goes through.
 *
 * Returns a failure rather than throwing, so a caller that forgets to handle
 * it fails to compile rather than surfacing a stack trace to an engineer
 * mid-quote.
 */
export function authorise(
  actor: Actor | null,
  capability: Capability,
): { readonly ok: true; readonly actor: Actor } | { readonly ok: false; readonly failure: AuthFailure } {
  if (actor === null) {
    return {
      ok: false,
      failure: { kind: 'UNAUTHENTICATED', message: 'Sign in to continue.' },
    };
  }

  if (!can(actor, capability)) {
    return {
      ok: false,
      failure: {
        kind: 'FORBIDDEN',
        message: `${describeRole(actor.role)} cannot ${describeCapability(capability)}.`,
      },
    };
  }

  return { ok: true, actor };
}

export function describeRole(role: Role): string {
  switch (role) {
    case 'admin':
      return 'An administrator';
    case 'rateOwner':
      return 'The rate owner';
    case 'engineer':
      return 'An engineer';
    case 'viewer':
      return 'A viewer';
  }
}

export function describeCapability(capability: Capability): string {
  switch (capability) {
    case 'rate.edit':
      return 'edit rates';
    case 'lme.enter':
      return 'enter a copper price';
    case 'line.override':
      return 'override a line price';
    case 'quote.approve':
      return 'approve a quote';
    case 'account.manage':
      return 'manage accounts';
    case 'read':
      return 'read this';
  }
}

/**
 * The port `infra/auth` implements. Declared here so nothing in modules/ ever
 * needs to know how a session is carried.
 */
export interface SessionReader {
  currentActor(): Promise<Actor | null>;
}
