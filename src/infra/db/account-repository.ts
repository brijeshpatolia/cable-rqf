import type { PrismaClient } from '@prisma/client';
import type { AccessChange, AccountView, NewAccount, RoleChange } from '@/modules/accounts';
import type { Role } from '@/modules/auth';
import { generatePassword, hashPassword } from '@/infra/auth/password';
import { prisma as defaultClient } from './client';

/**
 * Accounts.
 *
 * The screen decides nothing — `modules/accounts` has already decided whether
 * a request is allowed and well-formed, and handed back a plan with the audit
 * row attached. This performs it.
 *
 * **The password is generated here and nowhere else.** It is created, hashed,
 * and returned exactly once to be shown on screen; it is never stored in
 * plaintext, never logged, and never passes through a module. If it is lost,
 * it is reset by generating another. That is the same guarantee the
 * command-line script has always given, moved behind a screen so granting a
 * colleague access no longer needs a checkout of the repository.
 *
 * **Nothing is deleted.** Withdrawing access sets `disabled_at`, which keeps
 * the row, the name, and every audit event that account ever wrote. Deleting a
 * user would orphan or erase their history, and an audit trail with people
 * missing from it is not one.
 */

interface Row {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly role: string;
  readonly disabled_at: Date | null;
  readonly created_at: Date;
}

const SELECT = `
  SELECT id::text, email, name, role::text, disabled_at, created_at
    FROM app_user`;

function view(r: Row): AccountView {
  return {
    id: r.id,
    email: r.email,
    name: r.name,
    role: r.role as Role,
    disabledAt: r.disabled_at,
    createdAt: r.created_at,
  };
}

export class DbAccountRepository {
  constructor(private readonly prisma: PrismaClient = defaultClient) {}

  /** Everyone, disabled included — revoked access is a thing you need to see. */
  async list(): Promise<readonly AccountView[]> {
    const rows = await this.prisma.$queryRawUnsafe<Row[]>(
      `${SELECT} ORDER BY disabled_at IS NOT NULL, created_at`,
    );
    return rows.map(view);
  }

  /**
   * Create the account and write its own creation into its audit trail, in one
   * transaction.
   *
   * Both or neither: an account that exists with no record of who granted it
   * is precisely the row an audit is for, and a trail claiming an account that
   * was never made is worse than no trail.
   */
  async create(plan: NewAccount): Promise<{ readonly password: string }> {
    const password = generatePassword();
    const passwordHash = await hashPassword(password);

    await this.prisma.$transaction(async (tx) => {
      const user = await tx.appUser.create({
        data: {
          email: plan.email,
          name: plan.name,
          role: plan.role as never,
          passwordHash,
        },
      });
      await tx.auditEvent.create({
        data: {
          // Attributed to the administrator who did it, not to the account
          // being made — the new account has not done anything yet.
          actorId: plan.audit.actorId,
          actorEmail: plan.audit.actorEmail,
          entity: plan.audit.entity,
          field: plan.audit.field,
          previous: plan.audit.previous,
          next: plan.audit.next,
          reason: plan.audit.reason,
        },
      });
      return user;
    });

    return { password };
  }

  async setAccess(plan: AccessChange): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.appUser.update({
        where: { id: plan.id },
        data: { disabledAt: plan.disabled ? new Date() : null },
      });
      /*
        Sessions are not cleared here, and that is a deliberate limit worth
        knowing: `session.currentActor()` re-reads the account on every
        request, so a disabled user is turned away at their next page load
        rather than mid-render. Nothing they do in between is authorised,
        because every write re-checks.
      */
      await tx.auditEvent.create({ data: { ...plan.audit } });
    });
  }

  async setRole(plan: RoleChange): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.appUser.update({
        where: { id: plan.id },
        data: { role: plan.role as never },
      });
      await tx.auditEvent.create({ data: { ...plan.audit } });
    });
  }

  /** Reset a lost password. Returns the new one, shown once. */
  async resetPassword(id: string): Promise<{ readonly password: string }> {
    const password = generatePassword();
    await this.prisma.appUser.update({
      where: { id },
      data: { passwordHash: await hashPassword(password) },
    });
    return { password };
  }
}
