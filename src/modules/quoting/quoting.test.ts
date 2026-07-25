import { describe, expect, it } from 'vitest';
import { type Decimal, ZERO, dec } from '@/core/decimal';
import { metres } from '@/core/units';
import { SOURCE_LME, SOURCE_TERMS, products, rateSetAt } from '@/infra/data';
import type { Actor } from '@/modules/auth';
import { computeCost } from '@/modules/costing';
import {
  DEFAULT_VALIDITY_DAYS,
  type DraftLine,
  assembleQuote,
  copperMassOf,
  isExpired,
  nextQuoteNumber,
  totalOf,
} from './index';

const ACTOR: Actor = {
  id: 'u1',
  email: 'engineer@nuhas.example',
  name: 'An Engineer',
  role: 'engineer',
};

const AT = new Date('2026-07-24T10:00:00Z');
const RATES = rateSetAt(AT, SOURCE_LME);
const LIBRARY = products();

function draft(index = 0, qty = '12000'): DraftLine {
  const product = LIBRARY[index]!;
  const result = computeCost(
    product,
    { metres: metres(qty) },
    RATES,
    SOURCE_TERMS,
  );
  if (!result.ok) throw new Error(result.error.message);
  return {
    requestText: `${product.spec.cores}C x ${product.spec.sizeMm2.toString()}mm2`,
    productCode: product.id,
    sourceSheet: product.sourceSheet ?? '',
    designation: product.designation,
    quantityMetres: dec(qty),
    breakdown: result.value,
  };
}

const request = (over: Partial<Parameters<typeof assembleQuote>[0]> = {}) => ({
  customer: 'Muscat Electricals LLC',
  lines: [draft(0), draft(1)],
  unpricedCount: 0,
  pricedAt: AT,
  actor: ACTOR,
  ...over,
});

describe('assembleQuote', () => {
  it('assembles priced lines into a quote', () => {
    const result = assembleQuote(request());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.lines).toHaveLength(2);
    expect(result.value.customer).toBe('Muscat Electricals LLC');
    expect(result.value.total.greaterThan(0)).toBe(true);
  });

  it('refuses while any line is unpriced', () => {
    // The rule the whole product rests on: nothing leaves the building
    // carrying a line nobody costed.
    const result = assembleQuote(request({ unpricedCount: 2 }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('UNPRICED_LINES');
      expect(result.error.message).toContain('never leaves');
    }
  });

  it('refuses a quote with no customer and one with no lines', () => {
    expect(assembleQuote(request({ customer: '  ' })).ok).toBe(false);
    expect(assembleQuote(request({ lines: [] })).ok).toBe(false);
  });

  it('stamps the strike from the rates the lines were priced on', () => {
    const result = assembleQuote(request());
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.lmeStruck.toString()).toBe(SOURCE_LME.toString());
    expect(result.value.fxStruck.toString()).toBe('0.3845');
  });

  it('sets validity from the pricing instant, not from today', () => {
    const result = assembleQuote(request());
    if (!result.ok) throw new Error('expected ok');
    const days =
      (result.value.validUntil.getTime() - AT.getTime()) / (24 * 60 * 60 * 1000);
    expect(days).toBe(DEFAULT_VALIDITY_DAYS);
  });

  it('totals to the sum of its lines, without rounding on the way', () => {
    const result = assembleQuote(request());
    if (!result.ok) throw new Error('expected ok');

    const byHand = result.value.lines.reduce<Decimal>(
      (acc, l) => acc.plus(l.lineTotal),
      ZERO,
    );
    expect(result.value.total.toFixed(6)).toBe(byHand.toFixed(6));
  });
});

describe('a quote as a promise', () => {
  it('expires, and says so', () => {
    const result = assembleQuote(request());
    if (!result.ok) throw new Error('expected ok');
    const quote = {
      ...result.value,
      id: 'q1',
      number: 'Q-2026-0001',
      status: 'approved' as const,
      createdBy: null,
      createdAt: AT,
      approvedAt: AT,
      lines: result.value.lines.map((l, i) => ({ ...l, position: i })),
    };

    expect(isExpired(quote, AT)).toBe(false);
    expect(isExpired(quote, new Date('2026-09-01T00:00:00Z'))).toBe(true);
  });

  it('knows how much copper it is exposed to', () => {
    const result = assembleQuote(request());
    if (!result.ok) throw new Error('expected ok');
    const lines = result.value.lines.map((l, i) => ({ ...l, position: i }));

    // kg/km over metres — the tonnage a copper move actually acts on.
    expect(copperMassOf(lines).greaterThan(0)).toBe(true);
    expect(totalOf(lines).toFixed(2)).toBe(result.value.total.toFixed(2));
  });
});

describe('nextQuoteNumber', () => {
  it('is sequential within a year and zero-padded', () => {
    expect(nextQuoteNumber(2026, 0)).toBe('Q-2026-0001');
    expect(nextQuoteNumber(2026, 147)).toBe('Q-2026-0148');
  });
});
