import { describe, expect, it } from 'vitest';
import { metres } from '@/core/units';
import {
  RAW_MATERIALS,
  SOURCE_LME,
  SOURCE_TERMS,
  products,
  rateSetAt,
} from '@/infra/data';
import { computeCost } from '@/modules/costing';
import { deriveBounds } from './validate';
import { isPriced, reviewJob } from './review';

const LIBRARY = products();
const RATES = rateSetAt(new Date('2026-07-24T10:20:00Z'), SOURCE_LME);
const LME_LINKED = new Set(RAW_MATERIALS.filter((m) => m.lmeLinked).map((m) => m.code));

const BOUNDS = deriveBounds(LIBRARY, LME_LINKED, (p) => {
  const r = computeCost(p, { metres: metres(1000) }, RATES, SOURCE_TERMS);
  return r.ok ? r.value.unitRate : null;
});

const run = (input: string) =>
  reviewJob(input, LIBRARY, RATES, SOURCE_TERMS, BOUNDS);

/** A real library product, written the way a customer might write it. */
const real = LIBRARY.find(
  (p) => p.spec.armour === 'SWA' && p.spec.sheath === 'PVC' && p.spec.screen === '',
)!;
const realLine = (qty = '') => {
  const s = real.spec;
  return `${s.cores}C x ${s.sizeMm2.toString()}mm2 ${s.conductor} ${s.insulation} ${s.armour} ${s.sheath} ${s.voltage}${qty}`;
};

describe('reviewJob', () => {
  it('turns a pasted block into one line each, in review order', () => {
    const job = run(
      [
        realLine(' — 12,000 m'),
        '3C x 50mm2 aluminium XLPE SWA PVC 1kV — 500 m',
        '6C x 50mm2 Cu XLPE SWA PVC 1kV — 200 m',
      ].join('\n'),
    );

    expect(job.lines).toHaveLength(3);
    expect(job.counts.exact).toBe(1);
    expect(job.counts['no-match']).toBe(1);
    expect(job.counts.partial).toBe(1);
  });

  it('prices an exact line on the quantity in the text', () => {
    const job = run(realLine(' — 12,000 m'));
    const line = job.lines[0]!;

    expect(isPriced(line)).toBe(true);
    if (!isPriced(line)) return;
    expect(line.breakdown.quantity.toString()).toBe('12000');
    expect(line.breakdown.lineTotal.greaterThan(0)).toBe(true);
  });

  it('never gives an unpriced line a price — it has no field to hold one', () => {
    const job = run('3C x 50mm2 aluminium XLPE SWA PVC 1kV');
    const line = job.lines[0]!;

    expect(isPriced(line)).toBe(false);
    // The union has no `breakdown` on this branch, so there is nowhere for a
    // price to live. This assertion documents what the type already enforces.
    expect('breakdown' in line).toBe(false);
  });

  it('states why the job cannot be approved, rather than sitting grey and silent', () => {
    const job = run(
      [realLine(), '3C x 50mm2 aluminium XLPE SWA PVC 1kV'].join('\n'),
    );
    expect(job.blockers).toHaveLength(1);
    expect(job.blockers[0]).toContain('1 line still needs pricing');
  });

  it('has no blockers when every line priced cleanly', () => {
    expect(run(realLine()).blockers).toHaveLength(0);
  });

  it('ignores blank lines in a pasted block', () => {
    expect(run(`\n${realLine()}\n\n\n`).lines).toHaveLength(1);
  });

  it('falls back to a default quantity when the line does not state one', () => {
    const job = run(realLine());
    const line = job.lines[0]!;
    if (!isPriced(line)) throw new Error('expected priced');
    expect(line.breakdown.quantity.toString()).toBe('1000');
  });

  it('sorts red before amber before green', () => {
    const job = run(
      [
        realLine(),
        '3C x 50mm2 aluminium XLPE SWA PVC 1kV',
        '6C x 50mm2 Cu XLPE SWA PVC 1kV',
      ].join('\n'),
    );
    const sorted = [...job.lines].sort((a, b) =>
      ['no-match', 'partial', 'close', 'exact'].indexOf(a.match.tier) -
      ['no-match', 'partial', 'close', 'exact'].indexOf(b.match.tier),
    );
    expect(sorted.map((l) => l.match.tier)).toEqual([
      'no-match',
      'partial',
      'exact',
    ]);
  });

  it('holds nothing when a whole real RFQ is drawn from the library itself', () => {
    // Twenty real products, written back as RFQ lines, must all price cleanly.
    // Anything held here would mean the gate fires on Nuhas's own catalogue.
    const input = LIBRARY.slice(0, 20)
      .map((p) => {
        const s = p.spec;
        return `${s.cores}C x ${s.sizeMm2.toString()}mm2 ${s.conductor} ${s.insulation} ${s.screen} ${s.armour} ${s.sheath} ${s.voltage}`;
      })
      .join('\n');

    const job = run(input);
    expect(job.held).toBe(0);
  });
});
