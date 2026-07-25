/**
 * Seeds the imported cost master over Neon's HTTP endpoint.
 *
 * Run: `pnpm db:seed:http`
 *
 * Same data and the same read-back guarantee as `pnpm db:seed`, delivered over
 * HTTPS rather than the Postgres wire protocol, for environments that cannot
 * open port 5432.
 *
 * Numbers are sent as strings and read back as text, exactly as the wire-
 * protocol seed does. The read-back comparison is the point: if a column type
 * ever rounds — or if Neon's Postgres 18 differs from the local 16 in any way
 * that matters — it fails here rather than months later as a parity failure.
 */
import { neon } from '@neondatabase/serverless';
import {
  DRIVERS,
  RAW_MACHINES,
  RAW_MATERIALS,
  RAW_PRODUCTS,
} from '../src/infra/data';

const url = process.env['NEON_DIRECT_URL'] ?? process.env['DIRECT_URL'];
if (url === undefined || url === '') {
  console.error('Set NEON_DIRECT_URL (or DIRECT_URL).');
  process.exit(1);
}
const sql = neon(url);

const IMPORTED_AT = '2026-01-01T00:00:00Z';

const expected = new Map<string, string>();
const remember = (k: string, v: string | null) => {
  if (v !== null) expected.set(k, v);
};

/** Postgres literal. Numbers arrive as strings and stay strings. */
const lit = (v: string | number | boolean | null): string => {
  if (v === null) return 'NULL';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return `'${String(v).replace(/'/g, "''")}'`;
};

/** Kept well under Neon's HTTP statement size limit. */
const CHUNK = 200;

async function insertRows(table: string, columns: string[], rows: string[][]) {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const values = slice.map((r) => `(${r.join(',')})`).join(',');
    await sql.query(
      `INSERT INTO "${table}" (${columns.map((c) => `"${c}"`).join(',')}) VALUES ${values}`,
    );
  }
}

async function main() {
  console.log('\nSeeding Neon over HTTP\n');

  // Children first — foreign keys are RESTRICT, and nothing here is a soft
  // delete: this is a reseed of reference data, not a history rewrite.
  for (const t of ['overhead_line', 'machine_op', 'bom_line', 'product', 'material_rate', 'machine_rate']) {
    await sql.query(`DELETE FROM "${t}"`);
  }

  // ── Materials ────────────────────────────────────────────────────────
  await insertRows(
    'material_rate',
    ['id', 'code', 'description', 'uom', 'rate', 'lme_linked', 'drawing_premium', 'valid_from', 'valid_to'],
    RAW_MATERIALS.map((m) => {
      remember(`material:${m.code}:rate`, m.rate);
      remember(`material:${m.code}:premium`, m.drawingPremium);
      return [
        'gen_random_uuid()', lit(m.code), lit(m.description), lit(m.uom),
        `${lit(m.rate)}::numeric`, lit(m.lmeLinked),
        m.drawingPremium === null ? 'NULL' : `${lit(m.drawingPremium)}::numeric`,
        `${lit(IMPORTED_AT)}::timestamptz`, 'NULL',
      ];
    }),
  );
  console.log(`  materials       ${RAW_MATERIALS.length}`);

  // ── Machines ─────────────────────────────────────────────────────────
  await insertRows(
    'machine_rate',
    ['id', 'code', 'stage', 'rate', 'valid_from', 'valid_to'],
    RAW_MACHINES.map((m) => {
      remember(`machine:${m.code}:rate`, m.rate);
      return [
        'gen_random_uuid()', lit(m.code), lit(m.stage), `${lit(m.rate)}::numeric`,
        `${lit(IMPORTED_AT)}::timestamptz`, 'NULL',
      ];
    }),
  );
  console.log(`  machines        ${RAW_MACHINES.length}`);

  // ── Products ─────────────────────────────────────────────────────────
  // Ids are generated here rather than by the database so the children can
  // reference them without a round trip per product.
  const ids = new Map<string, string>();
  for (const p of RAW_PRODUCTS) ids.set(`${p.id}::${p.sourceSheet}`, crypto.randomUUID());

  await insertRows(
    'product',
    ['id', 'code', 'source_sheet', 'designation', 'family', 'standard', 'cores',
     'size_mm2', 'conductor', 'insulation', 'screen', 'armour', 'sheath',
     'voltage', 'tooling_per_km'],
    RAW_PRODUCTS.map((p) => {
      const k = `${p.id}::${p.sourceSheet}`;
      remember(`product:${k}:size`, p.sizeMm2);
      remember(`product:${k}:tooling`, p.toolingPerKm);
      return [
        `${lit(ids.get(k)!)}::uuid`, lit(p.id), lit(p.sourceSheet), lit(p.designation),
        lit(p.family), lit(p.standard), String(p.cores), `${lit(p.sizeMm2)}::numeric`,
        lit(p.conductor), lit(p.insulation), lit(p.screen), lit(p.armour),
        lit(p.sheath), lit(p.voltage), `${lit(p.toolingPerKm)}::numeric`,
      ];
    }),
  );
  console.log(`  products        ${RAW_PRODUCTS.length}`);

  const bom: string[][] = [];
  const ops: string[][] = [];
  const oh: string[][] = [];

  for (const p of RAW_PRODUCTS) {
    const k = `${p.id}::${p.sourceSheet}`;
    const pid = `${lit(ids.get(k)!)}::uuid`;

    p.bom.forEach((b, i) => {
      remember(`bom:${k}:${i}:consumption`, b.consumption);
      remember(`bom:${k}:${i}:scrap`, b.scrap);
      bom.push(['gen_random_uuid()', pid, lit(b.materialKey), lit(b.materialName),
        `${lit(b.consumption)}::numeric`, `${lit(b.scrap)}::numeric`, String(i)]);
    });

    p.operations.forEach((o, i) => {
      remember(`op:${k}:${i}:hours`, o.hoursPerKm);
      remember(`op:${k}:${i}:cores`, o.cores);
      ops.push(['gen_random_uuid()', pid, lit(o.machineKey), lit(o.machineName),
        String(o.sequence), `${lit(o.hoursPerKm)}::numeric`, `${lit(o.cores)}::numeric`]);
    });

    p.overheads.forEach((o, i) => {
      remember(`oh:${k}:${i}:amount`, o.amount);
      oh.push(['gen_random_uuid()', pid, lit(o.key), lit(o.name),
        `${lit(o.amount)}::numeric`, String(i)]);
    });
  }

  await insertRows('bom_line',
    ['id', 'product_id', 'material_key', 'material_name', 'consumption', 'scrap', 'position'], bom);
  console.log(`  bom lines       ${bom.length}`);

  await insertRows('machine_op',
    ['id', 'product_id', 'machine_key', 'machine_name', 'sequence', 'hours_per_km', 'cores'], ops);
  console.log(`  operations      ${ops.length}`);

  await insertRows('overhead_line',
    ['id', 'product_id', 'key', 'name', 'amount', 'position'], oh);
  console.log(`  overhead lines  ${oh.length}`);

  // ── Copper driver ────────────────────────────────────────────────────
  // Append-only: an existing tick is left alone rather than replaced.
  const existing = (await sql.query(
    `SELECT 1 FROM lme_price WHERE at = $1::timestamptz`, [IMPORTED_AT],
  )) as unknown[];

  if (existing.length === 0) {
    await sql.query(
      `INSERT INTO lme_price (id, at, lme, fx, entered_by)
       VALUES (gen_random_uuid(), $1::timestamptz, $2::numeric, $3::numeric, $4)`,
      [IMPORTED_AT, DRIVERS.lme.toString(), DRIVERS.fx.toString(), 'imported — cost master basis'],
    );
    console.log(`  lme ticks       1 (${DRIVERS.lme.toString()} USD/t)`);
  } else {
    console.log('  lme ticks       already present, left as-is (append-only)');
  }

  await verify();
}

async function verify() {
  const actual = new Map<string, string>();
  const rows = async (q: string) => (await sql.query(q)) as Record<string, string>[];

  for (const m of await rows(
    `SELECT code, rate::text AS rate, drawing_premium::text AS premium
       FROM material_rate WHERE valid_to IS NULL`)) {
    actual.set(`material:${m['code']}:rate`, m['rate']!);
    if (m['premium'] !== null) actual.set(`material:${m['code']}:premium`, m['premium']!);
  }
  for (const m of await rows(
    `SELECT code, rate::text AS rate FROM machine_rate WHERE valid_to IS NULL`)) {
    actual.set(`machine:${m['code']}:rate`, m['rate']!);
  }
  for (const p of await rows(
    `SELECT code, source_sheet AS sheet, size_mm2::text AS size, tooling_per_km::text AS tooling FROM product`)) {
    actual.set(`product:${p['code']}::${p['sheet']}:size`, p['size']!);
    actual.set(`product:${p['code']}::${p['sheet']}:tooling`, p['tooling']!);
  }
  for (const b of await rows(
    `SELECT p.code, p.source_sheet AS sheet, b.position, b.consumption::text AS c, b.scrap::text AS s
       FROM bom_line b JOIN product p ON p.id=b.product_id`)) {
    actual.set(`bom:${b['code']}::${b['sheet']}:${b['position']}:consumption`, b['c']!);
    actual.set(`bom:${b['code']}::${b['sheet']}:${b['position']}:scrap`, b['s']!);
  }
  for (const o of await rows(
    `SELECT p.code, p.source_sheet AS sheet, o.sequence, o.hours_per_km::text AS h, o.cores::text AS c
       FROM machine_op o JOIN product p ON p.id=o.product_id`)) {
    const i = Number(o['sequence']) - 1;
    actual.set(`op:${o['code']}::${o['sheet']}:${i}:hours`, o['h']!);
    actual.set(`op:${o['code']}::${o['sheet']}:${i}:cores`, o['c']!);
  }
  for (const o of await rows(
    `SELECT p.code, p.source_sheet AS sheet, o.position, o.amount::text AS a
       FROM overhead_line o JOIN product p ON p.id=o.product_id`)) {
    actual.set(`oh:${o['code']}::${o['sheet']}:${o['position']}:amount`, o['a']!);
  }

  const bad: string[] = [];
  for (const [k, want] of expected) {
    const got = actual.get(k);
    if (got === undefined) bad.push(`${k}: missing`);
    else if (got !== want) bad.push(`${k}: wrote ${want}, read back ${got}`);
  }

  console.log(`\n  read-back       ${expected.size} numerics compared`);
  if (bad.length > 0) {
    console.error(`\n✗ ${bad.length} value(s) did not survive the round trip:`);
    for (const b of bad.slice(0, 10)) console.error(`    ${b}`);
    process.exitCode = 1;
    return;
  }
  console.log('  round trip      exact on every value');
  console.log('\n✓ seed complete\n');
}

await main();
