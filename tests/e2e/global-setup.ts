import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../../src/infra/auth/password';
import { ACCOUNTS } from './accounts';

/**
 * The accounts the browser tests sign in as.
 *
 * There is no self-signup — an administrator makes accounts — so the tests
 * make their own, the same way `scripts/create-user.ts` does, before the
 * first browser opens. Upserted rather than created so a re-run against the
 * same database is a re-run and not a unique-constraint failure, and re-hashed
 * every time so a password changed by an earlier test cannot lock the suite
 * out.
 */
export default async function globalSetup(): Promise<void> {
  const connectionString = process.env['DIRECT_URL'] ?? process.env['DATABASE_URL'];
  if (connectionString === undefined) {
    throw new Error(
      'DATABASE_URL is not set. The browser tests need the same migrated, ' +
        'seeded Postgres the DB suite does: DATABASE_URL in .env.',
    );
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    for (const account of Object.values(ACCOUNTS)) {
      const passwordHash = await hashPassword(account.password);
      await prisma.appUser.upsert({
        where: { email: account.email },
        update: { name: account.name, role: account.role, passwordHash, disabledAt: null },
        create: { email: account.email, name: account.name, role: account.role, passwordHash },
      });
    }
  } finally {
    await prisma.$disconnect();
  }
}
