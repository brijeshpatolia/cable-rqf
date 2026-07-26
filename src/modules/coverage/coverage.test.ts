import { describe, expect, it } from 'vitest';
import { dec } from '@/core/decimal';
import type { LineStatus } from '@/modules/matching';
import { SUGGESTED, coverageOf, type CountedLine } from './index';

/**
 * The number a six-week phase turns on.
 *
 * PROJECT_PLAN.md is explicit that Phase 4 is built only on evidence, and just
 * as explicit about what the evidence is. These tests are about the edges of
 * that arithmetic — where an honest measure and a flattering one part company.
 */

const line = (status: LineStatus, metres: string | null = '1000'): CountedLine => ({
  status,
  metres: metres === null ? null : dec(metres),
});

describe('coverageOf', () => {
  it('counts partial and no-match as the library failing to cover a line', () => {
    const c = coverageOf([
      line('exact'),
      line('exact'),
      line('partial', null),
      line('no-match', null),
    ]);

    expect(c.byVolume.uncovered).toBe(2);
    expect(c.byVolume.total).toBe(4);
    expect(c.byVolume.percent?.toFixed(1)).toBe('50.0');
  });

  it('does not count a hand-priced line against the library', () => {
    /*
      A line priced by an engineer's judgement is one a construction model
      would also have had to guess at. Folding it in with Partial and No-match
      would inflate the case for building the very thing being decided on.
    */
    const c = coverageOf([line('exact'), line('hand-priced'), line('chosen'), line('close')]);

    expect(c.byVolume.uncovered).toBe(0);
    expect(c.justified).toBe(false);
    expect(c.counts['hand-priced']).toBe(1);
  });

  it('reports every status, so the shape of the demand is visible', () => {
    const c = coverageOf([line('exact'), line('exact'), line('close'), line('no-match', null)]);
    expect(c.counts).toEqual({
      exact: 2,
      close: 1,
      chosen: 0,
      'hand-priced': 0,
      partial: 0,
      'no-match': 1,
    });
  });

  it('is justified when either threshold is passed, not only both', () => {
    // One very long uncovered line is exactly what the second threshold exists
    // to catch, and it is invisible in a line count.
    const many = Array.from({ length: 99 }, () => line('exact', '10'));
    const c = coverageOf([...many, line('partial', '5000')]);

    expect(c.byVolume.past).toBe(false); // 1 line in 100
    expect(c.byQuantity.past).toBe(true); // but most of the metres
    expect(c.justified).toBe(true);
  });

  it('measures metres, because an unpriceable line has no quoted value', () => {
    /*
      Taken literally the plan's ">20% of quoted value" can never fire: a
      Partial line is one nothing could price, so its contribution to quoted
      value is zero by construction and the share would read 0.0% for ever
      while looking like evidence. Metres come from the enquiry itself.
    */
    const c = coverageOf([line('exact', '1000'), line('no-match', '9000')]);

    expect(c.byQuantity.uncovered).toBe(9000);
    expect(c.byQuantity.total).toBe(10000);
    expect(c.byQuantity.percent?.toFixed(0)).toBe('90');
    expect(c.justified).toBe(true);
  });

  it('a line with no readable quantity joins neither side of the metre share', () => {
    // Assuming a default would put a number the customer never wrote into the
    // evidence for a six-week decision.
    const c = coverageOf([line('exact', '900'), line('partial', null)]);

    expect(c.byVolume.percent?.toFixed(0)).toBe('50');
    expect(c.byQuantity.uncovered).toBe(0);
    expect(c.byQuantity.total).toBe(900);
  });

  it('no data is not evidence for building something', () => {
    const c = coverageOf([]);
    expect(c.byVolume.percent).toBeNull();
    expect(c.byQuantity.percent).toBeNull();
    expect(c.byVolume.past).toBe(false);
    expect(c.justified).toBe(false);
  });

  it('a threshold is passed only when exceeded, not when met', () => {
    // The plan says ">15%", and a phase that costs six weeks should not start
    // on a tie.
    const at15 = [...Array.from({ length: 17 }, () => line('exact')), line('partial', null), line('partial', null), line('partial', null)];
    expect(coverageOf(at15).byVolume.percent?.toFixed(0)).toBe('15');
    expect(coverageOf(at15).byVolume.past).toBe(false);

    const past15 = [...Array.from({ length: 16 }, () => line('exact')), line('partial', null), line('partial', null), line('partial', null), line('partial', null)];
    expect(coverageOf(past15).byVolume.past).toBe(true);
  });

  it('honours a threshold Nuhas sets instead of the suggested one', () => {
    const lines = [line('exact'), line('exact'), line('exact'), line('partial', null)];
    expect(coverageOf(lines, SUGGESTED).byVolume.past).toBe(true); // 25% > 15%
    expect(coverageOf(lines, { volumePercent: 40, quantityPercent: 50 }).byVolume.past).toBe(
      false,
    );
  });
});
