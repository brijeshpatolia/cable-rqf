/**
 * Creates a user account.
 *
 * Run: pnpm user:add -- --email you@example.com --name "Your Name" --role rateOwner
 *
 * There is no self-signup. Accounts are created deliberately by an
 * administrator, which for ten internal users is the right amount of process.
 * The password is generated, shown once, and never recoverable — reset it by
 * running this again.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { generatePassword, hashPassword } from '../src/infra/auth/password';

const ROLES = ['rateOwner', 'engineer', 'viewer'] as const;
type Role = (typeof ROLES)[number];

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const email = arg('email')?.trim().toLowerCase();
const name = arg('name')?.trim();
const role = arg('role')?.trim() as Role | undefined;

if (email === undefined || name === undefined || role === undefined) {
  console.error(
    'Usage: pnpm user:add -- --email <email> --name "<name>" --role <' +
      ROLES.join('|') + '>',
  );
  process.exit(1);
}

if (!ROLES.includes(role)) {
  console.error(`Unknown role "${role}". One of: ${ROLES.join(', ')}`);
  process.exit(1);
}

const connectionString = process.env['DIRECT_URL'];
if (connectionString === undefined) {
  console.error('DIRECT_URL is not set.');
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const password = generatePassword();
const passwordHash = await hashPassword(password);

const user = await prisma.appUser.upsert({
  where: { email },
  update: { name, role, passwordHash, disabledAt: null },
  create: { email, name, role, passwordHash },
});

// The account's own creation is the first thing in its audit trail.
await prisma.auditEvent.create({
  data: {
    actorId: user.id,
    actorEmail: user.email,
    entity: `app_user:${user.email}`,
    field: 'account',
    previous: '—',
    next: role,
    reason: 'Account created by administrator',
  },
});

console.log(`\n  ${user.email}  (${role})`);
console.log(`  password: ${password}`);
console.log('\n  Shown once. Store it in a password manager.\n');

await prisma.$disconnect();
