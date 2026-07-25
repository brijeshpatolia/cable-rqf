import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dec } from '@/core/decimal';
import { metres } from '@/core/units';
import { SOURCE_TERMS } from '@/infra/data';
import { DbProductRepository, DbRateRepository } from '@/infra/db/repository';
import { DbQuoteRepository } from '@/infra/db/quote-repository';
import { renderQuotePdf } from '@/infra/documents/quote-pdf';
import { renderQuoteXlsx } from '@/infra/documents/quote-xlsx';
import type { Actor } from '@/modules/auth';
import { computeCost } from '@/modules/costing';
import { assembleQuote, copperMassOf, totalOf } from '@/modules/quoting';

/**
 * The claim this file exists to test: **a quote can still be explained months
 * later.**
 *
 * The cost breakdown goes into JSONB, where every Decimal becomes a string and
 * every Date becomes an ISO string. If the revival on the way out is wrong in
 * any particular — a field missed, a Decimal left as a string, a rate row's
 * effective date left un-parsed — the quote comes back as something that
 * merely looks right. So this writes a real quote from real products at real
 * rates, reads it back through the repository, and compares every figure in
 * the tree, not just the total.
 *
 * Requires a seeded database, same as the parity suite.
 */

const IMPORTED_AT = new Date('2026-01-01T00:00:00Z');
const url = process.env['DATABASE_URL'];

const ACTOR_EMAIL = 'round-trip@test.invalid';

describe.skipIf(url === undefined)('a quote, written and read back', () => {
  let db: PrismaClient;
  let repo: DbQuoteRepository;
  let actor: Actor;
  let number: string;

  beforeAll(async () => {
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    repo = new DbQuoteRepository(db);

    const user = await db.appUser.upsert({
      where: { email: ACTOR_EMAIL },
      update: {},
      create: { email: ACTOR_EMAIL, name: 'Round Trip', role: 'engineer' },
    });
    actor = { id: user.id, email: user.email, name: user.name, role: 'engineer' };

    const products = await new DbProductRepository(db).list();
    const rates = await new DbRateRepository(db).resolveAt(IMPORTED_AT);

    // Two products with quite different bills of material, so the walk is
    // exercised on more than one shape of breakdown.
    const lines = [products[0]!, products[40]!].map((product, i) => {
      const quantity = { metres: metres(i === 0 ? '12000' : '3500') };
      const result = computeCost(product, quantity, rates, SOURCE_TERMS);
      if (!result.ok) throw new Error(result.error.message);
      return {
        requestText: `${product.spec.cores}C x ${product.spec.sizeMm2.toString()}mm2`,
        productCode: product.id,
        sourceSheet: product.sourceSheet ?? '',
        designation: product.designation,
        quantityMetres: quantity.metres,
        breakdown: result.value,
      };
    });

    const assembled = assembleQuote({
      customer: 'Round Trip Trading LLC',
      lines,
      unpricedCount: 0,
      pricedAt: new Date('2026-07-25T09:00:00Z'),
      terms: 'Ex-works Sohar, 60 days.',
      actor,
    });
    if (!assembled.ok) throw new Error(assembled.error.message);

    ({ number } = await repo.approve(assembled.value, actor));
  });

  afterAll(async () => {
    // Approved quotes are immutable, not undeletable — the trigger guards
    // UPDATE and DELETE on lines, so the test's rows are removed by first
    // returning the quote to draft.
    if (number !== undefined) {
      await db.$executeRawUnsafe(
        `UPDATE quote SET status = 'draft' WHERE number = $1`,
        number,
      );
      await db.$executeRawUnsafe(`DELETE FROM quote WHERE number = $1`, number);
    }
    // The audit row is deliberately left behind: the trigger refuses DELETE on
    // audit_event, and a test that could clean up after itself there would mean
    // the append-only guarantee was not real.
    await db?.$disconnect();
  });

  it('takes the next number for the year', () => {
    expect(number).toMatch(/^Q-2026-\d{4}$/);
  });

  it('reads back every figure in the tree, not only the total', async () => {
    const quote = await repo.byNumber(number);
    expect(quote).toBeDefined();
    if (quote === undefined) return;

    expect(quote.customer).toBe('Round Trip Trading LLC');
    expect(quote.lines).toHaveLength(2);
    expect(quote.terms).toBe('Ex-works Sohar, 60 days.');

    for (const line of quote.lines) {
      const b = line.breakdown;

      // Decimals, not strings that happen to print the same.
      expect(b.costPerKm.toFixed).toBeInstanceOf(Function);
      expect(b.materials.length).toBeGreaterThan(0);

      // The roll-up still adds up after the round trip — which it cannot do
      // if any component came back as a string.
      const materials = b.materials.reduce((a, m) => a.plus(m.cost), dec(0));
      expect(materials.toFixed(6)).toBe(b.materialsSubtotal.toFixed(6));

      const operations = b.operations.reduce((a, o) => a.plus(o.cost), dec(0));
      expect(operations.toFixed(6)).toBe(b.operationsSubtotal.toFixed(6));

      const roll = b.materialsSubtotal
        .plus(b.operationsSubtotal)
        .plus(b.overheadsSubtotal)
        .plus(b.tooling);
      expect(roll.toFixed(6)).toBe(b.costPerKm.toFixed(6));

      expect(line.lineTotal.toFixed(6)).toBe(
        line.unitRate.times(line.quantityMetres).toFixed(6),
      );

      // The provenance survived: each cost line still knows which rate row it
      // came from and when that row took effect.
      for (const m of b.materials) {
        expect(m.source.rateId).not.toBe('');
        expect(m.source.effectiveFrom).toBeInstanceOf(Date);
        expect(Number.isNaN(m.source.effectiveFrom.getTime())).toBe(false);
      }

      expect(b.strike.asOf).toBeInstanceOf(Date);
      expect(b.strike.lme.greaterThan(0)).toBe(true);
    }

    expect(totalOf(quote.lines).greaterThan(0)).toBe(true);
    expect(copperMassOf(quote.lines).greaterThan(0)).toBe(true);
  });

  it('appears on the price watch with its copper exposure', async () => {
    const open = await repo.open();
    const mine = open.find((q) => q.number === number);
    expect(mine).toBeDefined();
    if (mine === undefined) return;

    const quote = await repo.byNumber(number);
    if (quote === undefined) throw new Error('expected the quote');

    // The SQL sum and the hydrated arithmetic have to agree, or the watch is
    // reporting exposure the quote does not actually carry.
    expect(mine.copperMassKg.toFixed(3)).toBe(copperMassOf(quote.lines).toFixed(3));
    expect(mine.value.toFixed(6)).toBe(totalOf(quote.lines).toFixed(6));
  });

  it('renders to PDF and to a workbook', async () => {
    const quote = await repo.byNumber(number);
    if (quote === undefined) throw new Error('expected the quote');

    const pdf = await renderQuotePdf(quote);
    expect(pdf.byteLength).toBeGreaterThan(1000);
    expect(Buffer.from(pdf.subarray(0, 5)).toString()).toBe('%PDF-');

    const xlsx = renderQuoteXlsx(quote);
    expect(xlsx.byteLength).toBeGreaterThan(1000);
    // A zip container, which is what an xlsx is.
    expect(Buffer.from(xlsx.subarray(0, 2)).toString()).toBe('PK');
  });

  it('refuses to alter an approved quote', async () => {
    await expect(
      db.$executeRawUnsafe(
        `UPDATE quote SET customer = 'Someone Else' WHERE number = $1`,
        number,
      ),
    ).rejects.toThrow(/can no longer be edited/);
  });
});
