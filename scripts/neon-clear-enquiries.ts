/**
 * Clears the enquiries — jobs and quotes — leaving the app fresh.
 *
 * Run: `pnpm enquiries:clear:http`          (counts only, deletes nothing)
 *      `pnpm enquiries:clear:http --confirm` (actually deletes)
 *
 * **A dry run by default, on purpose.** This is the one script here that
 * destroys work rather than creating it, and the damage is not recoverable
 * from inside the app. So the default is to report what a run *would* delete
 * and stop; deleting takes a second, deliberate invocation. A flag is cheap
 * insurance against the muscle memory of re-running the last command.
 *
 * **What goes.** `job` and `quote`, and by cascade their lines. That is what
 * "enquiry" means here: a customer document that came in, and the quote struck
 * from it.
 *
 * **What stays, and why it is not an oversight.**
 *
 * - The cost master — products, BOM lines, machine ops, overheads, material
 *   and machine rates, LME prices. This is the priced knowledge the app exists
 *   to apply; clearing enquiries is not a reason to re-import it.
 * - `audit_event`. Despite the name it is *not* an enquiry trail: its entities
 *   are `material_rate:XSAUINS` and `lme_price` — the Rate Owner's record of
 *   who changed which cost and why. That record answers "why was this 4.812 in
 *   March?" long after the quote that asked is gone, and deleting it because
 *   the word "audit" sounds transactional would quietly destroy the one
 *   history nobody can reconstruct.
 * - Accounts and sessions. Wiping these locks everyone out and is a different
 *   operation with a different script.
 * - The vocabulary and substitution rules. These are curated by hand and
 *   accumulate value across enquiries, which is the whole reason they are
 *   stored rather than re-derived.
 *
 * **Order.** `job_line` and `quote_line` cascade from their parents and need
 * no statement of their own. Two things do not cascade and are handled first:
 * `job.quote_id` is `SetNull`, so jobs go before quotes; and `quote.supersedes_id`
 * is `Restrict`, a self-reference that makes a corrected quote un-deletable
 * while its replacement points at it — so the chain is broken before the
 * delete rather than fighting it row by row.
 */
import { neon } from '@neondatabase/serverless';

const url = process.env['NEON_DIRECT_URL'] ?? process.env['DIRECT_URL'];
if (url === undefined || url === '') {
  console.error('Set NEON_DIRECT_URL (or DIRECT_URL).');
  process.exit(1);
}
const sql = neon(url);

const confirmed = process.argv.includes('--confirm');

/** Rows as plain objects, matching the other Neon scripts here. */
const rows = async (q: string): Promise<Record<string, string | null>[]> =>
  (await sql.query(q)) as Record<string, string | null>[];

const countOf = async (table: string): Promise<number> => {
  const r = await rows(`SELECT count(*)::text AS n FROM ${table}`);
  return Number(r[0]?.['n'] ?? '0');
};

const GOING = ['job', 'job_line', 'quote', 'quote_line'] as const;
const STAYING = [
  'app_user',
  'product',
  'bom_line',
  'material_rate',
  'machine_rate',
  'audit_event',
  'vocabulary_term',
  'substitution_rule',
] as const;

async function main() {
  const host = new URL(url as string).hostname;
  console.log(`\n  database        ${host}`);
  console.log(`  mode            ${confirmed ? 'DELETE' : 'dry run — nothing will be deleted'}\n`);

  console.log('  to be cleared');
  let total = 0;
  for (const t of GOING) {
    const n = await countOf(t);
    total += n;
    console.log(`    ${t.padEnd(20)} ${n}`);
  }

  console.log('\n  to be kept');
  for (const t of STAYING) {
    console.log(`    ${t.padEnd(20)} ${await countOf(t)}`);
  }

  if (!confirmed) {
    console.log(`\n  ${total} row(s) would be deleted.`);
    console.log('  Re-run with --confirm to delete them.\n');
    return;
  }

  if (total === 0) {
    console.log('\n✓ nothing to clear — the app is already fresh\n');
    return;
  }

  // Jobs first: `job.quote_id` is SetNull, so a surviving job would otherwise
  // be left pointing at nothing.
  await sql.query('DELETE FROM job');
  // The supersession chain is Restrict; break it before deleting, not during.
  await sql.query('UPDATE quote SET supersedes_id = NULL WHERE supersedes_id IS NOT NULL');
  await sql.query('DELETE FROM quote');

  console.log('\n  after');
  let left = 0;
  for (const t of GOING) {
    const n = await countOf(t);
    left += n;
    console.log(`    ${t.padEnd(20)} ${n}`);
  }

  if (left > 0) {
    console.error(`\n✗ ${left} row(s) survived the delete — stopping so this is not mistaken for success\n`);
    process.exitCode = 1;
    return;
  }

  console.log('\n✓ enquiries cleared — the cost master, audit trail and accounts are untouched\n');
}

await main();
