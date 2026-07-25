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
    decision: null,
  };
}

/** A line nobody costed, priced by an engineer's judgement alone. */
function handPriced(rate = '7.5', qty = '4000'): DraftLine {
  return {
    requestText: '3C x 50mm2 aluminium XLPE SWA PVC 1kV',
    productCode: '',
    sourceSheet: '',
    designation: '3C x 50mm2 aluminium XLPE SWA PVC 1kV',
    quantityMetres: dec(qty),
    breakdown: null,
    decision: {
      unitRate: dec(rate),
      reason: 'Quoted from the 2025 aluminium job, plus 4% on copper drawing.',
      by: ACTOR.name,
      at: AT,
    },
  };
}

const STRIKE = {
  lme: SOURCE_LME,
  fx: dec('0.3845'),
  marginPercent: dec('15'),
};

const request = (over: Partial<Parameters<typeof assembleQuote>[0]> = {}) => ({
  customer: 'Muscat Electricals LLC',
  lines: [draft(0), draft(1)],
  unpricedCount: 0,
  strike: STRIKE,
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

  it('carries a hand-priced line, with no invented build-up', () => {
    const result = assembleQuote(request({ lines: [draft(0), handPriced()] }));
    if (!result.ok) throw new Error(result.error.message);

    const manual = result.value.lines[1]!;
    // The absence is the point: no zero-filled tree pretending to be a costing.
    expect(manual.breakdown).toBeNull();
    expect(manual.decision?.reason).toContain('aluminium job');
    expect(manual.unitRate.toString()).toBe('7.5');
    expect(manual.lineTotal.toFixed(2)).toBe('30000.00');
  });

  it('records a chosen product as a decision, with no rate of its own', () => {
    // The other half of the M marker: an engineer who named the product made a
    // decision too, and the quote has to remember that after the job closes.
    const chosen = draft(0);
    const result = assembleQuote(
      request({
        lines: [
          {
            ...chosen,
            decision: {
              unitRate: null,
              reason: 'Customer confirmed 3-core is acceptable.',
              by: ACTOR.name,
              at: AT,
            },
          },
        ],
      }),
    );
    if (!result.ok) throw new Error(result.error.message);

    const line = result.value.lines[0]!;
    expect(line.decision).not.toBeNull();
    expect(line.decision?.unitRate).toBeNull();
    // The engine's own number stands, because nobody replaced it.
    expect(line.unitRate.toString()).toBe(chosen.breakdown!.unitRate.toString());
  });

  it('lets an override replace the engine on a line that was costed', () => {
    const costed = draft(0);
    const engineRate = costed.breakdown!.unitRate;
    const result = assembleQuote(
      request({
        lines: [
          {
            ...costed,
            decision: {
              unitRate: engineRate.plus(1),
              reason: 'Matching a competitor on a strategic account.',
              by: ACTOR.name,
              at: AT,
            },
          },
        ],
      }),
    );
    if (!result.ok) throw new Error(result.error.message);

    const line = result.value.lines[0]!;
    // The build-up survives — it still explains the *cost*. The override
    // explains the *price*, and the two are different questions.
    expect(line.breakdown).not.toBeNull();
    expect(line.unitRate.toString()).toBe(engineRate.plus(1).toString());
    expect(line.lineTotal.toFixed(6)).toBe(
      engineRate.plus(1).times(dec('12000')).toFixed(6),
    );
  });

  it('refuses a line carrying neither a build-up nor a hand price', () => {
    const result = assembleQuote(
      request({
        lines: [{ ...draft(0), breakdown: null, decision: null }],
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('UNPRICED_LINES');
  });

  it('stamps the strike even when the first line was priced by hand', () => {
    // The bug this prevents: reading the strike off lines[0].breakdown makes a
    // quote's provenance depend on the order its lines arrived in.
    const result = assembleQuote(request({ lines: [handPriced(), draft(0)] }));
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.lmeStruck.toString()).toBe(SOURCE_LME.toString());
    expect(result.value.marginPercent.toString()).toBe('15');
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
    } satisfies Parameters<typeof isExpired>[0];

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
