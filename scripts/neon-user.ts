/**
 * Creates or resets a user over Neon's HTTP endpoint.
 *
 * Run: pnpm user:add:http -- --email you@example.com --name "Your Name" --role admin
 *
 * The same job as `create-user.ts`, down a different pipe. That one speaks the
 * Postgres wire protocol on port 5432, which plenty of environments cannot
 * open — this container cannot, and neither can some CI runners and
 * locked-down networks. Neon also serves SQL over HTTPS, which those same
 * environments can reach, and `neon-apply.ts` already exists for exactly this
 * reason on migrations.
 *
 * Day to day neither script is the way in: an administrator makes accounts on
 * the Accounts screen. These stay for the one account that screen cannot make
 * — the first administrator, because until one exists nobody can reach the
 * screen that makes them.
 */
import { neon } from '@neondatabase/serverless';
import { generatePassword, hashPassword } from '../src/infra/auth/password';

const ROLES = ['admin', 'rateOwner', 'engineer', 'viewer'] as const;
type Role = (typeof ROLES)[number];

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const email = arg('email')?.trim().toLowerCase();
const name = arg('name')?.trim();
const role = arg('role')?.trim() as Role | undefined;
const chosen = arg('password');

if (email === undefined || name === undefined || role === undefined) {
  console.error(
    'Usage: pnpm user:add:http -- --email <email> --name "<name>" --role <' +
      ROLES.join('|') +
      '> [--password <password>]',
  );
  process.exit(1);
}

if (!ROLES.includes(role)) {
  console.error(`Unknown role "${role}". One of: ${ROLES.join(', ')}`);
  process.exit(1);
}

const url = process.env['DIRECT_URL'] ?? process.env['DATABASE_URL'];
if (url === undefined || url === '') {
  console.error('Set DIRECT_URL (or DATABASE_URL) to the Neon connection string.');
  process.exit(1);
}

const sql = neon(url);

/*
  The enum value, in case the migration has not been applied to this database
  yet. Idempotent, and cheaper than failing halfway with a role the column
  cannot hold.
*/
if (role === 'admin') {
  await sql`ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'admin'`;
}

const password = chosen ?? generatePassword();
const passwordHash = await hashPassword(password);

const rows = (await sql`
  INSERT INTO app_user (id, email, name, role, password_hash)
  VALUES (gen_random_uuid(), ${email}, ${name}, ${role}::"Role", ${passwordHash})
  ON CONFLICT (email) DO UPDATE
    SET name = EXCLUDED.name,
        role = EXCLUDED.role,
        password_hash = EXCLUDED.password_hash,
        disabled_at = NULL
  RETURNING id::text, email
`) as { id: string; email: string }[];

const user = rows[0];
if (user === undefined) throw new Error('The account was not written.');

// The account's own creation is the first thing in its audit trail.
await sql`
  INSERT INTO audit_event (id, actor_id, actor_email, entity, field, previous, next, reason)
  VALUES (gen_random_uuid(), ${user.id}::uuid, ${user.email},
          ${`app_user:${user.email}`}, 'account', '—', ${role},
          'Account created by administrator')
`;

console.log(`\n  ${user.email}  (${role})`);
console.log(`  password: ${chosen === undefined ? password : '(the one you supplied)'}`);
console.log(
  chosen === undefined
    ? '\n  Shown once. Store it in a password manager.\n'
    : '\n  Chosen rather than generated — it is in your shell history. Clear it.\n',
);
