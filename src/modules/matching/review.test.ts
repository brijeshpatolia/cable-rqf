import { describe, expect, it } from 'vitest';
import { dec } from '@/core/decimal';
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
import {
  type LineDecision,
  byReviewOrder,
  hasBreakdown,
  isManual,
  isPriced,
  pricedValueOf,
  reviewJob,
} from './review';
import { BUILT_IN_TERMS, buildDictionary, mergeTerms } from './vocabulary';

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
    if (!hasBreakdown(line)) throw new Error('expected a build-up');
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
    if (!hasBreakdown(line)) throw new Error('expected priced');
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

  it('reports unfamiliar wording so the screen can ask about it', () => {
    const job = run('3C x 50mm2 Cu XLPE SWA PVC 1kV with unobtainium bedding');
    expect(job.unknownTerms).toContain('unobtainium');
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

/**
 * The human-in-the-loop path.
 *
 * These are the decisions the app asks for rather than guessing at: a line it
 * cannot match, answered by a person. The tests below are the contract for
 * what an answer is allowed to do — and, just as importantly, what it isn't.
 */
describe('decisions a human makes about a line', () => {
  const ALUMINIUM = '3C x 50mm2 aluminium XLPE SWA PVC 1kV — 4,000 m';
  const AT = new Date('2026-07-25T09:00:00Z');

  const withDecisions = (input: string, decisions: LineDecision[]) =>
    reviewJob(input, LIBRARY, RATES, SOURCE_TERMS, BOUNDS, { decisions });

  it('prices a no-match line by hand, and says who and why', () => {
    const job = withDecisions(ALUMINIUM, [
      {
        position: 0,
        override: {
          unitRate: dec('7.5'),
          reason: 'Quoted off the 2025 aluminium job.',
          by: 'An Engineer',
          at: AT,
        },
      },
    ]);

    const line = job.lines[0]!;
    expect(line.status).toBe('hand-priced');
    if (!isPriced(line)) throw new Error('expected a price');

    expect(line.unitRate.toString()).toBe('7.5');
    expect(line.lineTotal.toFixed(2)).toBe('30000.00');
    expect(job.blockers).toHaveLength(0);

    // No build-up is invented for it. The absence is the honest answer.
    expect(hasBreakdown(line)).toBe(false);
    expect(isManual(line)).toBe(true);

    // And the matcher's own verdict is still there, so the screen can show
    // what the app thought before a person overruled it.
    expect(line.match.tier).toBe('no-match');
  });

  it('prices a partial line as a product the engineer named, through the engine', () => {
    const job = withDecisions('6C x 50mm2 Cu XLPE SWA PVC 1kV — 2,000 m', [
      {
        position: 0,
        choice: {
          productCode: real.id,
          sourceSheet: real.sourceSheet ?? '',
          reason: 'Same construction, customer confirmed 3-core is acceptable.',
          by: 'An Engineer',
          at: AT,
        },
      },
    ]);

    const line = job.lines[0]!;
    expect(line.status).toBe('chosen');
    if (!hasBreakdown(line)) throw new Error('expected a build-up');

    // The point of choosing a product rather than typing a price: the line is
    // still explainable down to the kilogram.
    expect(line.breakdown.materials.length).toBeGreaterThan(0);
    expect(line.breakdown.quantity.toString()).toBe('2000');
    expect(job.blockers).toHaveLength(0);

    // And the app still says out loud what was swapped.
    expect(line.differences.length).toBeGreaterThan(0);
    expect(line.differences.some((d) => d.axis === 'cores')).toBe(true);
    expect(line.choice?.reason).toContain('customer confirmed');
  });

  it('lets an override replace the engine on a line that matched exactly', () => {
    const job = withDecisions(realLine(' — 1,000 m'), [
      {
        position: 0,
        override: {
          unitRate: dec('9.99'),
          reason: 'Strategic account.',
          by: 'An Engineer',
          at: AT,
        },
      },
    ]);

    const line = job.lines[0]!;
    // Still Exact — the matcher was right about *what* it is. The override is
    // about what it costs.
    expect(line.status).toBe('exact');
    if (!hasBreakdown(line)) throw new Error('expected a build-up');

    expect(line.unitRate.toString()).toBe('9.99');
    expect(line.lineTotal.toFixed(2)).toBe('9990.00');
    // The build-up survives and still holds the engine's own number, so the
    // gap between cost and price stays visible.
    expect(line.breakdown.unitRate.equals(dec('9.99'))).toBe(false);
  });

  it('ignores a choice pointing at a product that no longer exists', () => {
    // Rather than silently pricing on something else.
    const job = withDecisions(ALUMINIUM, [
      {
        position: 0,
        choice: {
          productCode: 'GONE-FROM-THE-LIBRARY',
          sourceSheet: 'nowhere',
          reason: 'stale',
          by: 'An Engineer',
          at: AT,
        },
      },
    ]);

    expect(job.lines[0]!.status).toBe('no-match');
    expect(job.blockers).toHaveLength(1);
  });

  it('counts decided lines, and sinks them below untouched ones', () => {
    const job = withDecisions(
      [ALUMINIUM, '6C x 50mm2 Cu XLPE SWA PVC 1kV'].join('\n'),
      [
        {
          position: 0,
          override: {
            unitRate: dec('7.5'),
            reason: 'Quoted off the 2025 aluminium job.',
            by: 'An Engineer',
            at: AT,
          },
        },
      ],
    );

    expect(job.decided).toBe(1);
    const sorted = [...job.lines].sort(byReviewOrder);
    // The untouched Partial comes first: it is what still needs an answer.
    expect(sorted.map((l) => l.status)).toEqual(['partial', 'hand-priced']);
  });

  it('teaches the dictionary a word, and the line that paused resolves', () => {
    const line = '3C x 50mm2 Cu XLPE SWA XLPO 1kV — 500 m';

    const before = run(line);
    expect(before.unknownTerms).toContain('xlpo');
    expect(isPriced(before.lines[0]!)).toBe(false);

    // The Rate Owner answers once: XLPO is what this customer calls PVC
    // sheathing. Every future job knows it.
    const taught = buildDictionary(
      mergeTerms(BUILT_IN_TERMS, [
        { canonical: 'PVC', axis: 'sheath', synonyms: ['xlpo'] },
      ]),
    );

    const after = reviewJob(line, LIBRARY, RATES, SOURCE_TERMS, BOUNDS, {
      dictionary: taught,
    });
    expect(after.unknownTerms).toHaveLength(0);
    expect(after.lines[0]!.status).toBe('exact');
  });

  it('pricedValueOf ignores lines still open', () => {
    const job = withDecisions(
      [realLine(' — 1,000 m'), ALUMINIUM].join('\n'),
      [],
    );
    const priced = job.lines.filter(isPriced);
    expect(priced).toHaveLength(1);
    expect(pricedValueOf(job.lines).toFixed(6)).toBe(
      priced[0]!.lineTotal.toFixed(6),
    );
  });
});
