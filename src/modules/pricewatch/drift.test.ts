import { describe, expect, it } from 'vitest';
import { dec } from '@/core/decimal';
import { omr, usdPerTonne } from '@/core/units';
import { assessDrift, driftHeadline, sweep, type OpenQuote } from './drift';

const NOW = new Date('2026-07-24T10:00:00Z');

const quote = (over: Partial<OpenQuote> = {}): OpenQuote => ({
  quoteId: 'Q-1001',
  customer: 'Muscat Electricals',
  struckLme: usdPerTonne('9340'),
  struckAt: new Date('2026-07-01T08:00:00Z'),
  expiresAt: new Date('2026-08-15T00:00:00Z'),
  value: omr('59916.54'),
  copperMassKg: dec('8372.16'),
  fx: dec('0.3845'),
  ...over,
});

describe('drift', () => {
  it('flags a quote when copper moves past the threshold', () => {
    const r = assessDrift(quote(), usdPerTonne('9720'), NOW);
    expect(r.status).toBe('breached');
    expect(r.lmeDelta.toFixed(0)).toBe('380');
    expect(r.lmePercent.toFixed(2)).toBe('4.07');
  });

  it('leaves a quote alone inside the threshold', () => {
    expect(assessDrift(quote(), usdPerTonne('9450'), NOW).status).toBe('within');
  });

  it('flags a fall as readily as a rise', () => {
    const r = assessDrift(quote(), usdPerTonne('8900'), NOW);
    expect(r.status).toBe('breached');
    expect(r.exposure.isNegative()).toBe(true);
  });

  it('prices the exposure on the quote actual copper mass', () => {
    const r = assessDrift(quote(), usdPerTonne('9720'), NOW);
    // 380 × 0.3845 ÷ 1000 × 8372.16 = 1,223.2562976 OMR
    expect(r.exposure.toFixed(2)).toBe('1223.26');
  });

  it('reports a lapsed quote as lapsed, not breached', () => {
    const r = assessDrift(
      quote({ expiresAt: new Date('2026-07-01T00:00:00Z') }),
      usdPerTonne('9720'),
      NOW,
    );
    expect(r.status).toBe('lapsed');
  });

  it('excludes lapsed quotes from total exposure', () => {
    const s = sweep(
      [quote(), quote({ quoteId: 'Q-2', expiresAt: new Date('2026-07-01') })],
      usdPerTonne('9720'),
      NOW,
    );
    expect(s.breached).toHaveLength(1);
    expect(s.totalExposure.toFixed(2)).toBe('1223.26');
  });

  it('writes the headline the spec asks for', () => {
    const s = sweep(
      [quote(), quote({ quoteId: 'Q-2' }), quote({ quoteId: 'Q-3' })],
      usdPerTonne('9720'),
      NOW,
    );
    expect(driftHeadline(s)).toBe(
      '3 open quotes were priced at LME 9,340. Copper is now 9,720.',
    );
  });

  it('reads as a range when the flagged quotes were struck at different prices', () => {
    const s = sweep(
      [quote(), quote({ quoteId: 'Q-2', struckLme: usdPerTonne('8994') })],
      usdPerTonne('9720'),
      NOW,
    );
    expect(driftHeadline(s)).toBe(
      '2 open quotes were priced between LME 8,994 and 9,340. Copper is now 9,720.',
    );
  });

  it('says nothing when nothing breached', () => {
    expect(driftHeadline(sweep([quote()], usdPerTonne('9400'), NOW))).toBeNull();
  });
});
