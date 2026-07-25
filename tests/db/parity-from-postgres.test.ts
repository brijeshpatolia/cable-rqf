import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dec } from '@/core/decimal';
import { metres } from '@/core/units';
import { SOURCE_TERMS } from '@/infra/data';
import { DbProductRepository, DbRateRepository } from '@/infra/db/repository';
import { computeCost } from '@/modules/costing';

/**
 * The parity harness, run against Postgres instead of the imported JSON.
 *
 * This is the test that proves the schema, not merely that it applies. The
 * same 99 golden fixtures — each carrying its own source cost sheet's answer —
 * are recomputed from rows read out of the database. If any column type
 * rounds, if `::text` is dropped anywhere, or if the adapter hydrates a value
 * through a different decimal implementation, these fail.
 *
 * Requires a seeded database. Run `pnpm db:seed` first; skipped when
 * TEST_DATABASE_URL is unset so `pnpm test` stays database-free.
 */

const FIXTURE_DIR = join(import.meta.dirname, '..', 'parity', 'fixtures');
const IMPORTED_AT = new Date('2026-01-01T00:00:00Z');

interface Fixture {
  readonly productId: string;
  readonly sourceSheet: string;
  readonly expected: {
    readonly materialsSubtotal: string;
    readonly operationsSubtotal: string;
    readonly overheadsSubtotal: string;
    readonly tooling: string;
    readonly costPerKm: string;
    readonly quotePerMetre: string;
  };
}

const fixtures: Fixture[] = readdirSync(FIXTURE_DIR)
  .filter((n) => n.endsWith('.json'))
  .map((n) => JSON.parse(readFileSync(join(FIXTURE_DIR, n), 'utf8')) as Fixture);

const url = process.env['DATABASE_URL'];

describe.skipIf(url === undefined)('parity, computed from Postgres', () => {
  let db: PrismaClient;
  let products: Awaited<ReturnType<DbProductRepository['list']>>;
  let rates: Awaited<ReturnType<DbRateRepository['resolveAt']>>;

  beforeAll(async () => {
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    products = await new DbProductRepository(db).list();
    rates = await new DbRateRepository(db).resolveAt(IMPORTED_AT);
  });

  afterAll(async () => {
    await db?.$disconnect();
  });

  it('read the whole library back', () => {
    expect(products).toHaveLength(99);
    expect(new Set(products.map((p) => p.id)).size).toBe(97);
    expect(rates.materials.size).toBe(133);
    expect(rates.machines.size).toBe(34);
    expect(rates.copper.lme.toString()).toBe('4850');
  });

  it('rebuilt every value at full precision', () => {
    // The value that would have been silently truncated under NUMERIC(18,6).
    const all = [...rates.materials.values()].map((m) => m.rate.toString());
    expect(all).toContain('1.83595955371857');
  });

  it('reproduces all 99 cost sheets from database rows', () => {
    const failures: string[] = [];

    for (const f of fixtures) {
      const product = products.find(
        (p) => p.id === f.productId && p.sourceSheet === f.sourceSheet,
      );
      if (product === undefined) {
        failures.push(`${f.productId}: not found in the database`);
        continue;
      }

      const result = computeCost(
        product,
        { metres: metres(1000) },
        rates,
        SOURCE_TERMS,
      );
      if (!result.ok) {
        failures.push(`${f.productId}: ${result.error.message}`);
        continue;
      }

      const b = result.value;
      const e = f.expected;
      const check = (label: string, got: { toFixed(n: number): string }, want: string) => {
        if (got.toFixed(6) !== dec(want).toFixed(6)) {
          failures.push(`${f.productId} ${label}: ${got.toFixed(6)} ≠ ${dec(want).toFixed(6)}`);
        }
      };

      check('materials', b.materialsSubtotal, e.materialsSubtotal);
      check('operations', b.operationsSubtotal, e.operationsSubtotal);
      check('overheads', b.overheadsSubtotal, e.overheadsSubtotal);
      check('tooling', b.tooling, e.tooling);
      check('cost/km', b.costPerKm, e.costPerKm);
      check('quote/m', b.unitRate, e.quotePerMetre);
    }

    expect(failures.slice(0, 5)).toEqual([]);
    expect(failures).toHaveLength(0);
  });

  it('resolves rates in one round of queries, not one per product', async () => {
    // The budget in PROJECT_PLAN.md §2.5: a 200-line quote resolves rates
    // once and then runs pure function calls over that snapshot. Costing the
    // whole library must issue no further statements.
    let statements = 0;
    const counting = new PrismaClient({
      adapter: new PrismaPg({ connectionString: url! }),
    }).$extends({
      query: {
        async $allOperations({ args, query }) {
          statements += 1;
          return query(args);
        },
      },
    }) as unknown as PrismaClient;

    const snapshot = await new DbRateRepository(counting).resolveAt(IMPORTED_AT);
    const afterResolve = statements;

    for (const p of products) {
      computeCost(p, { metres: metres(1000) }, snapshot, SOURCE_TERMS);
    }

    expect(afterResolve).toBeLessThanOrEqual(3);
    expect(statements).toBe(afterResolve);
    await (counting as unknown as PrismaClient).$disconnect();
  });

  it('refuses to price at an instant before any copper price existed', async () => {
    await expect(
      new DbRateRepository(db).resolveAt(new Date('2020-01-01T00:00:00Z')),
    ).rejects.toThrow(/did not yet exist/);
  });
});
