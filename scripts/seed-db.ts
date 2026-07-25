/**
 * Seed — the imported cost master → Postgres.
 *
 * Run: `pnpm db:seed`
 *
 * The imported JSON in `src/infra/data` is the output of
 * `pnpm run import:cost-master`, which reads the workbook and deliberately
 * carries every number through as a *string* so no float rounding happens
 * between the spreadsheet and here. This script continues that discipline:
 * values go into Postgres as strings and are read back as text.
 *
 * The read-back assertion is the point of this script, not a nicety. Every
 * numeric that goes in is read out again and compared for exact equality. If
 * a column type ever silently rounds — which is precisely what
 * `NUMERIC(18,6)` would have done to 53.7% of these values — this fails loudly
 * here rather than showing up months later as a parity failure nobody can
 * explain.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import {
  DRIVERS,
  RAW_MACHINES,
  RAW_MATERIALS,
  RAW_PRODUCTS,
} from '../src/infra/data';

/**
 * The instant the imported rates take effect.
 *
 * The workbook carries no rate history, so inventing effective periods would
 * be fiction. Every imported row is open-ended from this date; history starts
 * accruing the first time the rate owner edits something in the app.
 */
const IMPORTED_AT = new Date('2026-01-01T00:00:00Z');

const connectionString = process.env['DIRECT_URL'];
if (connectionString === undefined) {
  throw new Error('DIRECT_URL is not set. See .env.local.example.');
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

/** Every numeric that went in, so it can be read back and compared. */
const expected = new Map<string, string>();
const remember = (key: string, value: string | null) => {
  if (value !== null) expected.set(key, value);
};

async function main() {
  console.log('\nSeeding from the imported cost master\n');

  // Order matters: children reference products, so products go first and the
  // whole thing runs in one transaction — a half-seeded database is worse
  // than an empty one.
  await prisma.$transaction(async (tx) => {
    // Clearing uses DELETE rather than TRUNCATE so the append-only triggers
    // on audit_event and lme_price are respected. lme_price cannot be cleared
    // at all — a superseded tick is history — so seeding is idempotent by
    // skipping ticks that already exist.
    await tx.overheadLine.deleteMany();
    await tx.machineOp.deleteMany();
    await tx.bomLine.deleteMany();
    await tx.product.deleteMany();
    await tx.materialRate.deleteMany();
    await tx.machineRate.deleteMany();

    // ── Materials ────────────────────────────────────────────────────────
    for (const m of RAW_MATERIALS) {
      remember(`material:${m.code}:rate`, m.rate);
      remember(`material:${m.code}:premium`, m.drawingPremium);
      await tx.materialRate.create({
        data: {
          code: m.code,
          description: m.description,
          uom: m.uom,
          rate: m.rate,
          lmeLinked: m.lmeLinked,
          drawingPremium: m.drawingPremium,
          validFrom: IMPORTED_AT,
          validTo: null,
        },
      });
    }
    console.log(`  materials       ${RAW_MATERIALS.length}`);

    // ── Machines ─────────────────────────────────────────────────────────
    for (const m of RAW_MACHINES) {
      remember(`machine:${m.code}:rate`, m.rate);
      await tx.machineRate.create({
        data: {
          code: m.code,
          stage: m.stage,
          rate: m.rate,
          validFrom: IMPORTED_AT,
          validTo: null,
        },
      });
    }
    console.log(`  machines        ${RAW_MACHINES.length}`);

    // ── Products and their children ──────────────────────────────────────
    let bom = 0;
    let ops = 0;
    let overheads = 0;

    for (const p of RAW_PRODUCTS) {
      // Keyed by (code, sourceSheet): two cables share a product code across
      // two source sheets, so the sheet is part of the identity.
      const k = `${p.id}::${p.sourceSheet}`;
      remember(`product:${k}:size`, p.sizeMm2);
      remember(`product:${k}:tooling`, p.toolingPerKm);

      const created = await tx.product.create({
        data: {
          code: p.id,
          sourceSheet: p.sourceSheet,
          designation: p.designation,
          family: p.family,
          standard: p.standard,
          cores: p.cores,
          sizeMm2: p.sizeMm2,
          conductor: p.conductor,
          insulation: p.insulation,
          screen: p.screen,
          armour: p.armour,
          sheath: p.sheath,
          voltage: p.voltage,
          toolingPerKm: p.toolingPerKm,
        },
      });

      await tx.bomLine.createMany({
        data: p.bom.map((b, i) => {
          remember(`bom:${k}:${i}:consumption`, b.consumption);
          remember(`bom:${k}:${i}:scrap`, b.scrap);
          return {
            productId: created.id,
            materialKey: b.materialKey,
            materialName: b.materialName,
            consumption: b.consumption,
            scrap: b.scrap,
            position: i,
          };
        }),
      });
      bom += p.bom.length;

      await tx.machineOp.createMany({
        data: p.operations.map((o, i) => {
          remember(`op:${k}:${i}:hours`, o.hoursPerKm);
          remember(`op:${k}:${i}:cores`, o.cores);
          return {
            productId: created.id,
            machineKey: o.machineKey,
            machineName: o.machineName,
            sequence: o.sequence,
            hoursPerKm: o.hoursPerKm,
            cores: o.cores,
          };
        }),
      });
      ops += p.operations.length;

      await tx.overheadLine.createMany({
        data: p.overheads.map((o, i) => {
          remember(`oh:${k}:${i}:amount`, o.amount);
          return {
            productId: created.id,
            key: o.key,
            name: o.name,
            amount: o.amount,
            position: i,
          };
        }),
      });
      overheads += p.overheads.length;
    }

    console.log(`  products        ${RAW_PRODUCTS.length}`);
    console.log(`  bom lines       ${bom}`);
    console.log(`  operations      ${ops}`);
    console.log(`  overhead lines  ${overheads}`);
  });

  // ── The copper driver ──────────────────────────────────────────────────
  // Append-only, so an existing tick is left alone rather than replaced.
  const existing = await prisma.lmePrice.findUnique({ where: { at: IMPORTED_AT } });
  if (existing === null) {
    await prisma.lmePrice.create({
      data: {
        at: IMPORTED_AT,
        lme: DRIVERS.lme.toString(),
        fx: DRIVERS.fx.toString(),
        enteredBy: 'imported — cost master basis',
      },
    });
    console.log(`  lme ticks       1 (${DRIVERS.lme.toString()} USD/t)`);
  } else {
    console.log('  lme ticks       already present, left as-is (append-only)');
  }

  await verifyReadBack();
  console.log('\n✓ seed complete\n');
}

/**
 * Reads every seeded numeric back as text and compares it to what went in.
 *
 * `::text` on a Postgres numeric returns the value verbatim, so an exact
 * string comparison is the strongest assertion available: it catches silent
 * rounding, scale truncation, and any float that sneaks into the path.
 */
async function verifyReadBack() {
  const actual = new Map<string, string>();

  const materials = await prisma.$queryRaw<
    { code: string; rate: string; premium: string | null }[]
  >`SELECT code, rate::text AS rate, drawing_premium::text AS premium
      FROM material_rate WHERE valid_to IS NULL`;
  for (const m of materials) {
    actual.set(`material:${m.code}:rate`, m.rate);
    if (m.premium !== null) actual.set(`material:${m.code}:premium`, m.premium);
  }

  const machines = await prisma.$queryRaw<{ code: string; rate: string }[]>`
    SELECT code, rate::text AS rate FROM machine_rate WHERE valid_to IS NULL`;
  for (const m of machines) actual.set(`machine:${m.code}:rate`, m.rate);

  const products = await prisma.$queryRaw<
    { code: string; sheet: string; size: string; tooling: string }[]
  >`SELECT code, source_sheet AS sheet, size_mm2::text AS size,
           tooling_per_km::text AS tooling FROM product`;
  for (const p of products) {
    const k = `${p.code}::${p.sheet}`;
    actual.set(`product:${k}:size`, p.size);
    actual.set(`product:${k}:tooling`, p.tooling);
  }

  const bom = await prisma.$queryRaw<
    { code: string; sheet: string; position: number; c: string; s: string }[]
  >`SELECT p.code, p.source_sheet AS sheet, b.position,
           b.consumption::text AS c, b.scrap::text AS s
      FROM bom_line b JOIN product p ON p.id = b.product_id`;
  for (const b of bom) {
    const k = `${b.code}::${b.sheet}`;
    actual.set(`bom:${k}:${b.position}:consumption`, b.c);
    actual.set(`bom:${k}:${b.position}:scrap`, b.s);
  }

  const ops = await prisma.$queryRaw<
    { code: string; sheet: string; sequence: number; h: string; c: string }[]
  >`SELECT p.code, p.source_sheet AS sheet, o.sequence,
           o.hours_per_km::text AS h, o.cores::text AS c
      FROM machine_op o JOIN product p ON p.id = o.product_id`;
  for (const o of ops) {
    actual.set(`op:${o.code}::${o.sheet}:${o.sequence - 1}:hours`, o.h);
    actual.set(`op:${o.code}::${o.sheet}:${o.sequence - 1}:cores`, o.c);
  }

  const oh = await prisma.$queryRaw<
    { code: string; sheet: string; position: number; a: string }[]
  >`SELECT p.code, p.source_sheet AS sheet, o.position, o.amount::text AS a
      FROM overhead_line o JOIN product p ON p.id = o.product_id`;
  for (const o of oh) {
    actual.set(`oh:${o.code}::${o.sheet}:${o.position}:amount`, o.a);
  }

  const mismatches: string[] = [];
  let checked = 0;

  for (const [key, want] of expected) {
    const got = actual.get(key);
    checked += 1;
    if (got === undefined) {
      mismatches.push(`${key}: missing from database`);
    } else if (got !== want) {
      mismatches.push(`${key}: wrote ${want}, read back ${got}`);
    }
  }

  console.log(`\n  read-back       ${checked} numerics compared`);

  if (mismatches.length > 0) {
    console.error(`\n✗ ${mismatches.length} value(s) did not survive the round trip:\n`);
    for (const m of mismatches.slice(0, 10)) console.error(`    ${m}`);
    if (mismatches.length > 10) {
      console.error(`    … and ${mismatches.length - 10} more`);
    }
    console.error(
      '\n  This means a column type is rounding. Check that money columns are\n' +
        '  unconstrained NUMERIC — a fixed scale alters most of this library.\n',
    );
    process.exitCode = 1;
    throw new Error('read-back verification failed');
  }

  console.log('  round trip      exact on every value');
}

main()
  .catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
