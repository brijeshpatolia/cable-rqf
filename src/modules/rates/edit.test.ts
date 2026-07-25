import { describe, expect, it } from 'vitest';
import { dec } from '@/core/decimal';
import type { Actor } from '@/modules/auth';
import { type CurrentRate, planLmeEntry, planSupersede } from './edit';

const ACTOR: Actor = {
  id: 'u1',
  email: 'owner@nuhas.example',
  name: 'B. Patolia',
  role: 'rateOwner',
};

const JAN = new Date('2026-01-01T00:00:00Z');
const JUL = new Date('2026-07-24T00:00:00Z');

const fixed = (value: string): CurrentRate => ({
  row: {
    key: 'XSAUINS',
    value: dec(value),
    validFrom: JAN,
    validTo: null,
    rateId: 'r1',
    table: 'material_rate',
  },
  lmeLinked: false,
  drawingPremium: null,
});

const linked = (rate: string, premium: string): CurrentRate => ({
  row: {
    key: 'CC1F',
    value: dec(rate),
    validFrom: JAN,
    validTo: null,
    rateId: 'r2',
    table: 'material_rate',
  },
  lmeLinked: true,
  drawingPremium: dec(premium),
});

const request = (over: Partial<Parameters<typeof planSupersede>[0]> = {}) => ({
  kind: 'material' as const,
  code: 'XSAUINS',
  newValue: dec('0.62'),
  at: JUL,
  reason: 'Supplier price revision',
  actor: ACTOR,
  ...over,
});

describe('planSupersede', () => {
  it('closes the old row exactly where the new one begins', () => {
    const result = planSupersede(request(), fixed('0.5959'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Adjacent, not overlapping — this is the shape the EXCLUDE constraint
    // accepts, and the reason the decision is planned rather than improvised.
    expect(result.value.close.validTo).toEqual(JUL);
    expect(result.value.open.validFrom).toEqual(JUL);
    expect(result.value.close.rateId).toBe('r1');
  });

  it('records what moved, with both values, for the audit trail', () => {
    const result = planSupersede(request(), fixed('0.5959'));
    if (!result.ok) throw new Error('expected ok');

    expect(result.value.audit).toMatchObject({
      actorEmail: 'owner@nuhas.example',
      entity: 'material_rate:XSAUINS',
      field: 'rate',
      previous: '0.5959',
      next: '0.62',
      reason: 'Supplier price revision',
    });
  });

  it('refuses a rate this system does not hold', () => {
    const result = planSupersede(request(), undefined);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('UNKNOWN_CODE');
  });

  it('refuses to supersede a row someone else already closed', () => {
    const stale = fixed('0.5959');
    const result = planSupersede(request(), {
      ...stale,
      row: { ...stale.row, validTo: new Date('2026-06-01T00:00:00Z') },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_IN_FORCE');
      expect(result.error.message).toContain('someone else has changed it');
    }
  });

  it('requires a reason — it is the part a person reads months later', () => {
    const result = planSupersede(request({ reason: '   ' }), fixed('0.5959'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('REASON_REQUIRED');
  });

  it('refuses an effective date at or before the row it replaces', () => {
    for (const at of [JAN, new Date('2025-06-01T00:00:00Z')]) {
      const result = planSupersede(request({ at }), fixed('0.5959'));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('NOT_LATER');
    }
  });

  it('refuses a negative rate', () => {
    const result = planSupersede(request({ newValue: dec('-1') }), fixed('0.5959'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NEGATIVE');
  });

  it('writes nothing when the value has not actually changed', () => {
    const result = planSupersede(request({ newValue: dec('0.5959') }), fixed('0.5959'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NO_CHANGE');
  });

  it('needs a drawing premium for an LME-linked code, and rejects one otherwise', () => {
    const missing = planSupersede(
      request({ code: 'CC1F', newValue: dec('2') }),
      linked('1.973232', '0.108407'),
    );
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.code).toBe('PREMIUM_MISMATCH');

    const spurious = planSupersede(
      request({ newDrawingPremium: dec('0.1') }),
      fixed('0.5959'),
    );
    expect(spurious.ok).toBe(false);
    if (!spurious.ok) expect(spurious.error.code).toBe('PREMIUM_MISMATCH');
  });

  it('audits the premium, not the rate, when an LME-linked code changes', () => {
    // The stored rate on an LME-linked code is derived from copper and is not
    // what the owner edits — the premium is. The audit must say so.
    const result = planSupersede(
      request({
        code: 'CC1F',
        newValue: dec('1.973232'),
        newDrawingPremium: dec('0.120000'),
      }),
      linked('1.973232', '0.108407'),
    );
    if (!result.ok) throw new Error('expected ok');

    expect(result.value.audit.field).toBe('drawing_premium');
    expect(result.value.audit.previous).toBe('0.108407');
    expect(result.value.audit.next).toBe('0.12');
  });
});

describe('planLmeEntry', () => {
  it('accepts a later tick', () => {
    const result = planLmeEntry(
      { at: JUL, lme: dec('9340'), fx: dec('0.3845'), actor: ACTOR },
      { at: JAN, lme: dec('4850') },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.audit.previous).toBe('4850');
      expect(result.value.audit.next).toBe('9340');
      expect(result.value.enteredBy).toBe('B. Patolia');
    }
  });

  it('refuses to backdate — the series records moments, it is not edited', () => {
    const result = planLmeEntry(
      { at: JAN, lme: dec('9340'), fx: dec('0.3845'), actor: ACTOR },
      { at: JUL, lme: dec('4850') },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOT_LATER');
  });

  it('refuses a non-positive price or FX', () => {
    for (const [lme, fx] of [
      ['0', '0.3845'],
      ['9340', '0'],
      ['-1', '0.3845'],
    ] as const) {
      const result = planLmeEntry(
        { at: JUL, lme: dec(lme), fx: dec(fx), actor: ACTOR },
        undefined,
      );
      expect(result.ok).toBe(false);
    }
  });

  it('accepts the very first tick, with no previous value to report', () => {
    const result = planLmeEntry(
      { at: JAN, lme: dec('4850'), fx: dec('0.3845'), actor: ACTOR },
      undefined,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.audit.previous).toBe('—');
  });
});
