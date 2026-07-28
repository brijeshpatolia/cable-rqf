import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { dec } from '@/core/decimal';
import { metres } from '@/core/units';
import { SOURCE_LME, SOURCE_TERMS, products, rateSetAt } from '@/infra/data';
import type { Actor } from '@/modules/auth';
import { computeCost } from '@/modules/costing';
import {
  type DraftLine,
  type Quote,
  assembleQuote,
  copperMassOf,
  overriddenCount,
  uncostedCount,
} from '@/modules/quoting';
import { renderQuotePdf } from './quote-pdf';
import { renderQuoteXlsx } from './quote-xlsx';

/**
 * What the documents say about a line a person priced.
 *
 * There are two kinds and they were treated as one. A line the matcher could
 * not price has **no build-up**; a line it *did* price and an engineer then
 * overrode has a build-up and a human rate. `handPricedCount` counted both,
 * `copperMassOf` skipped only the first, and the PDF footer used one to
 * disclaim the other — so a quote carrying an override said its copper figure
 * excluded a line whose copper it had just weighed.
 *
 * The workbook was worse: the Quotation sheet showed the engineer's rate while
 * the Cost build-up sheet showed the engine rows underneath it, summing to a
 * different number, with the reason and the author recorded nowhere. That is
 * the one sheet whose whole purpose is explaining where a number came from.
 */

const ACTOR: Actor = {
  id: 'u1',
  email: 'engineer@nuhas.example',
  name: 'An Engineer',
  role: 'engineer',
};

const AT = new Date('2026-07-24T10:00:00Z');
const RATES = rateSetAt(AT, SOURCE_LME);
const LIBRARY = products();

const OVERRIDE_RATE = dec('9.875');
const OVERRIDE_REASON = 'Matched on the 2025 contract price, per the customer.';

function costed(index: number, qty: string): DraftLine {
  const product = LIBRARY[index]!;
  const result = computeCost(product, { metres: metres(qty) }, RATES, SOURCE_TERMS);
  if (!result.ok) throw new Error(result.error.message);
  return {
    requestText: `${product.spec.cores}C x ${product.spec.sizeMm2.toString()}mm2`,
    productCode: product.id,
    sourceSheet: product.sourceSheet ?? '',
    designation: product.designation,
    quantityMetres: metres(qty),
    breakdown: result.value,
    decision: null,
  };
}

/** A quote whose second line the engine costed and a person then re-priced. */
function quoteWithOverride(): Quote {
  const plain = costed(0, '12000');
  const overridden: DraftLine = {
    ...costed(40, '3500'),
    decision: {
      unitRate: OVERRIDE_RATE,
      reason: OVERRIDE_REASON,
      by: ACTOR.name,
      at: AT,
    },
  };

  const assembled = assembleQuote({
    customer: 'Override Trading LLC',
    lines: [plain, overridden],
    unpricedCount: 0,
    strike: {
      lme: RATES.copper.lme,
      fx: RATES.copper.fx,
      marginPercent: SOURCE_TERMS.marginPercent,
    },
    pricedAt: AT,
    terms: 'Ex-works Sohar, 60 days.',
    actor: ACTOR,
  });
  if (!assembled.ok) throw new Error(assembled.error.message);

  return {
    ...assembled.value,
    id: 'q1',
    number: 'Q-2026-0001',
    status: 'approved',
    createdBy: ACTOR.name,
    createdAt: AT,
    approvedAt: AT,
    supersedes: null,
    supersededBy: null,
    lines: assembled.value.lines.map((l, i) => ({ ...l, position: i })),
  };
}

const sheet = (book: XLSX.WorkBook, name: string): string =>
  XLSX.utils.sheet_to_csv(book.Sheets[name]!);

/**
 * The PDF's words, read back out of it.
 *
 * pdf-lib compresses its content streams, so grepping the raw bytes for a
 * sentence finds nothing whether the sentence is there or not — an assertion
 * that passes for the wrong reason in one direction and fails for the wrong
 * reason in the other. Read with pdf.js, which is the same library the app
 * uses on a customer's documents.
 */
async function textOf(bytes: Uint8Array): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({
    data: bytes,
    useWorkerFetch: false,
    useSystemFonts: false,
    verbosity: 0,
  }).promise;

  const out: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const content = await (await doc.getPage(p)).getTextContent();
    for (const item of content.items) if ('str' in item) out.push(item.str);
  }
  // Whitespace collapsed: pdf-lib emits kerned runs as separate text items, so
  // "Priced to order" comes back as three of them and a plain regex misses it.
  // The assertions here are about which words are on the page, not the spacing
  // a reader reconstructs between them.
  return out.join(' ').replace(/\s+/g, ' ');
}

describe('an override on a line the engine had already costed', () => {
  it('is a different thing from a line with no build-up', () => {
    const quote = quoteWithOverride();

    // The line kept its breakdown, so its copper is known and counted.
    expect(overriddenCount(quote.lines)).toBe(1);
    expect(uncostedCount(quote.lines)).toBe(0);
    expect(copperMassOf(quote.lines).greaterThan(0)).toBe(true);
  });

  it('charges the rate the person set, not the one the engine derived', () => {
    const quote = quoteWithOverride();
    const line = quote.lines[1]!;

    expect(line.unitRate.toString()).toBe(OVERRIDE_RATE.toString());
    expect(line.breakdown).not.toBeNull();
    // The two genuinely differ — otherwise this test proves nothing.
    expect(line.breakdown!.unitRate.toString()).not.toBe(OVERRIDE_RATE.toString());
  });

  it('does not tell the customer its copper figure excludes a line it counted', async () => {
    const text = await textOf(await renderQuotePdf(quoteWithOverride()));

    // The old footer said this on any override, including one whose copper was
    // inside the total printed on the line above it.
    expect(text).not.toMatch(/priced to order/i);
    expect(text).toMatch(/priced by hand against our own build-up/i);
  });

  it('still disclaims a line that genuinely has no build-up', async () => {
    const quote = quoteWithOverride();
    const uncosted = {
      ...quote.lines[1]!,
      breakdown: null,
      unitRate: OVERRIDE_RATE,
      lineTotal: quote.lines[1]!.lineTotal,
    };
    const text = await textOf(await renderQuotePdf({ ...quote, lines: [quote.lines[0]!, uncosted] }));

    expect(text).toMatch(/priced to order/i);
  });

  it('records the reason, the author and the date on the build-up sheet', () => {
    const book = XLSX.read(renderQuoteXlsx(quoteWithOverride()), { type: 'buffer' });
    const buildup = sheet(book, book.SheetNames[1]!);

    expect(buildup).toContain(OVERRIDE_REASON);
    expect(buildup).toContain(ACTOR.name);
    expect(buildup).toMatch(/Priced by hand/);
  });

  it('says the build-up under an override is not what is being charged', () => {
    const book = XLSX.read(renderQuoteXlsx(quoteWithOverride()), { type: 'buffer' });
    const buildup = sheet(book, book.SheetNames[1]!);

    // Without this the sheet reads as a derivation of the quoted rate, which
    // it is not — the rows sum to a number the customer is not being charged.
    expect(buildup).toMatch(/not what is being charged/i);
  });

  it('leaves a quote with no overrides saying nothing about them', async () => {
    const quote = quoteWithOverride();
    const clean = { ...quote, lines: [quote.lines[0]!] };

    const text = await textOf(await renderQuotePdf(clean));
    expect(text).not.toMatch(/priced by hand/i);
    expect(text).not.toMatch(/priced to order/i);

    const book = XLSX.read(renderQuoteXlsx(clean), { type: 'buffer' });
    expect(sheet(book, book.SheetNames[1]!)).not.toMatch(/Priced by hand/);
  });
});
