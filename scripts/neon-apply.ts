/**
 * Applies Prisma migrations over Neon's HTTP endpoint.
 *
 * Run: `pnpm db:deploy:http`
 *
 * `prisma migrate deploy` speaks the Postgres wire protocol on port 5432.
 * Plenty of environments cannot open that port — this container cannot, and
 * neither can some CI runners and locked-down networks — but Neon also serves
 * SQL over HTTPS, which those same environments can reach.
 *
 * This applies each pending migration statement by statement and records it in
 * `_prisma_migrations` exactly as Prisma would, so a later `prisma migrate
 * deploy` from a machine that *can* reach 5432 sees the migration as already
 * applied rather than trying to replay it.
 *
 * It is not a replacement for `migrate deploy`. It is the same SQL, delivered
 * down a different pipe.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { neon } from '@neondatabase/serverless';

const url = process.env['NEON_DIRECT_URL'] ?? process.env['DIRECT_URL'];
if (url === undefined || url === '') {
  console.error('Set NEON_DIRECT_URL (or DIRECT_URL) to the direct, non-pooled string.');
  process.exit(1);
}

const sql = neon(url);
const MIGRATIONS = join(process.cwd(), 'prisma/migrations');

/**
 * Splits a migration into statements.
 *
 * Naively splitting on `;` breaks the moment a migration contains a
 * dollar-quoted function body — which this one does, for the append-only
 * triggers. The scanner tracks single quotes, dollar-quoted blocks with
 * arbitrary tags, and line comments.
 */
function splitStatements(text: string): string[] {
  const out: string[] = [];
  let buffer = '';
  let i = 0;
  let inSingle = false;
  let dollarTag: string | null = null;

  while (i < text.length) {
    const rest = text.slice(i);

    if (dollarTag === null && !inSingle && rest.startsWith('--')) {
      const nl = text.indexOf('\n', i);
      i = nl === -1 ? text.length : nl + 1;
      continue;
    }

    if (!inSingle) {
      const open = /^\$([A-Za-z_]*)\$/.exec(rest);
      if (open !== null) {
        const tag = open[0];
        if (dollarTag === null) dollarTag = tag;
        else if (dollarTag === tag) dollarTag = null;
        buffer += tag;
        i += tag.length;
        continue;
      }
    }

    const ch = text[i]!;

    if (dollarTag === null && ch === "'") inSingle = !inSingle;

    if (ch === ';' && !inSingle && dollarTag === null) {
      const statement = buffer.trim();
      if (statement !== '') out.push(statement);
      buffer = '';
      i += 1;
      continue;
    }

    buffer += ch;
    i += 1;
  }

  const tail = buffer.trim();
  if (tail !== '') out.push(tail);
  return out;
}

async function ensureMigrationsTable() {
  // The same shape Prisma creates, so `migrate deploy` recognises it.
  await sql.query(`
    CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
      "id" VARCHAR(36) PRIMARY KEY NOT NULL,
      "checksum" VARCHAR(64) NOT NULL,
      "finished_at" TIMESTAMPTZ,
      "migration_name" VARCHAR(255) NOT NULL,
      "logs" TEXT,
      "rolled_back_at" TIMESTAMPTZ,
      "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
      "applied_steps_count" INTEGER NOT NULL DEFAULT 0
    )`);
}

async function appliedNames(): Promise<Set<string>> {
  const rows = (await sql.query(
    `SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`,
  )) as { migration_name: string }[];
  return new Set(rows.map((r) => r.migration_name));
}

async function main() {
  await ensureMigrationsTable();
  const done = await appliedNames();

  const names = readdirSync(MIGRATIONS)
    .filter((n) => !n.endsWith('.toml'))
    .sort();

  let appliedCount = 0;

  for (const name of names) {
    if (done.has(name)) {
      console.log(`  already applied  ${name}`);
      continue;
    }

    const file = join(MIGRATIONS, name, 'migration.sql');
    const text = readFileSync(file, 'utf8');
    const statements = splitStatements(text);

    console.log(`\n  applying  ${name}  (${statements.length} statements)`);

    for (const [index, statement] of statements.entries()) {
      try {
        await sql.query(statement);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        console.error(
          `\n  ✗ statement ${index + 1}/${statements.length} failed:\n` +
            `    ${statement.slice(0, 160).replace(/\s+/g, ' ')}…\n` +
            `    ${message}\n`,
        );
        // Deliberately not swallowed: a partly-applied migration must stop
        // loudly rather than be recorded as done.
        process.exitCode = 1;
        return;
      }
    }

    // Recorded only after every statement succeeded.
    await sql.query(
      `INSERT INTO "_prisma_migrations"
         (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
       VALUES ($1, $2, $3, now(), now(), $4)`,
      [
        crypto.randomUUID(),
        createHash('sha256').update(text).digest('hex'),
        name,
        statements.length,
      ],
    );

    appliedCount += 1;
    console.log(`  ✓ ${name}`);
  }

  const tables = (await sql.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema='public' AND table_name <> '_prisma_migrations'
      ORDER BY table_name`,
  )) as { table_name: string }[];

  console.log(
    `\n  ${appliedCount} migration(s) applied. ${tables.length} tables: ` +
      tables.map((t) => t.table_name).join(', '),
  );
}

await main();
