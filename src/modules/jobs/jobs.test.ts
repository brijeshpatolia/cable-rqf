import { describe, expect, it } from 'vitest';
import { dec } from '@/core/decimal';
import type { Actor } from '@/modules/auth';
import { nextJobReference, planDecision, statusLabel } from './index';

const ACTOR: Actor = {
  id: 'u1',
  email: 'engineer@nuhas.example',
  name: 'An Engineer',
  role: 'engineer',
};

const AT = new Date('2026-07-25T09:00:00Z');
const OPEN = { status: 'review' as const, reference: 'J-2026-0042' };

const request = (over: Partial<Parameters<typeof planDecision>[0]> = {}) => ({
  job: OPEN,
  position: 3,
  reason: 'Customer confirmed the 3-core is acceptable.',
  actor: ACTOR,
  at: AT,
  ...over,
});

describe('planDecision', () => {
  it('refuses a decision with no reason, in words an engineer can act on', () => {
    const result = planDecision(request({ reason: '   ', unitRate: dec('7.5') }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NO_REASON');
      expect(result.error.message).toContain('Say why');
    }
  });

  it('refuses an answer that decides nothing', () => {
    const result = planDecision(request());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOT_A_DECISION');
  });

  it('refuses a hand price of zero or below', () => {
    for (const rate of ['0', '-1']) {
      const result = planDecision(request({ unitRate: dec(rate) }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('BAD_RATE');
    }
  });

  it('refuses to change a job that has already been quoted', () => {
    const result = planDecision(
      request({
        job: { status: 'approved', reference: 'J-2026-0042' },
        unitRate: dec('7.5'),
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('JOB_CLOSED');
      // The message says what to do instead, not just that the door is shut.
      expect(result.error.message).toContain('start a new job');
    }
  });

  it('records who set a hand price, and when', () => {
    const result = planDecision(request({ unitRate: dec('7.5') }));
    if (!result.ok) throw new Error(result.error.message);

    expect(result.value.override?.unitRate.toString()).toBe('7.5');
    expect(result.value.override?.by).toBe('An Engineer');
    expect(result.value.override?.at).toBe(AT);
    expect(result.value.choice).toBeNull();
    // No line number: the audit row and the screen both already state it.
    expect(result.value.summary).toBe('rate set to 7.5 OMR/m');
  });

  it('records a product choice, keyed on both halves of the library key', () => {
    const result = planDecision(
      request({ product: { code: 'P07CS3M2XLVWVKNN', sourceSheet: 'LV' } }),
    );
    if (!result.ok) throw new Error(result.error.message);

    expect(result.value.choice?.productCode).toBe('P07CS3M2XLVWVKNN');
    expect(result.value.choice?.sourceSheet).toBe('LV');
    expect(result.value.override).toBeNull();
  });

  it('allows naming a product and then overriding its price', () => {
    // Both at once is legitimate: "it is this cable, but we are quoting it at
    // this number." Two facts, one reason.
    const result = planDecision(
      request({
        product: { code: 'P07CS3M2XLVWVKNN', sourceSheet: 'LV' },
        unitRate: dec('6.25'),
      }),
    );
    if (!result.ok) throw new Error(result.error.message);

    expect(result.value.choice).not.toBeNull();
    expect(result.value.override).not.toBeNull();
    expect(result.value.summary).toContain('priced as');
    expect(result.value.summary).toContain('rate set to');
  });

  it('trims the reason it stores, so whitespace cannot pass for an answer', () => {
    const result = planDecision(
      request({ unitRate: dec('7.5'), reason: '  off the 2025 job  ' }),
    );
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.override?.reason).toBe('off the 2025 job');
  });
});

describe('nextJobReference', () => {
  it('is sequential within a year and zero-padded', () => {
    expect(nextJobReference(2026, 0)).toBe('J-2026-0001');
    expect(nextJobReference(2026, 41)).toBe('J-2026-0042');
  });

  it('uses a different letter from a quote number', () => {
    // So nobody has to wonder whether the number on screen is one a customer
    // has seen.
    expect(nextJobReference(2026, 0).startsWith('J-')).toBe(true);
  });
});

describe('statusLabel', () => {
  it('says what a status means rather than naming the enum', () => {
    expect(statusLabel('review')).toBe('In review');
    expect(statusLabel('approved')).toBe('Quoted');
    expect(statusLabel('abandoned')).toBe('Closed');
  });
});
