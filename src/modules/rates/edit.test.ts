import { describe, expect, it } from 'vitest';
import { dec } from '@/core/decimal';
import type { Actor } from '@/modules/auth';
import {
  type CurrentRate,
  planAmendRate,
  planCreateRate,
  planLmeEntry,
  planSupersede,
} from './edit';

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
  description: 'Test material',
  uom: 'kg',
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
  description: 'Test copper',
  uom: 'kg',
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

/**
 * Adding to the master, and amending it.
 *
 * The Rate Owner could always do both in the spreadsheet and could not do
 * either here — Sudhir's second finding. What these tests pin down is that
 * neither becomes a back door for changing a price without superseding one.
 */
const AT = JAN;
const LATER = JUL;
const CURRENT = fixed('1.5');

describe('planCreateRate', () => {
  const request = (over: Partial<Parameters<typeof planCreateRate>[0]> = {}) => ({
    kind: 'material' as const,
    code: 'NEWMAT',
    description: 'New drum wrapper, 700 mm',
    uom: 'kg',
    value: dec('1.85'),
    at: AT,
    reason: 'New supplier line added to the master.',
    actor: ACTOR,
    ...over,
  });

  it('normalises the code, because a bill of materials points at it', () => {
    // `cc1f` and `CC1F ` naming two materials is invisible until a product
    // prices twice.
    const result = planCreateRate(request({ code: '  newmat ' }), undefined);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.code).toBe('NEWMAT');
  });

  it('refuses a code the master already holds', () => {
    const result = planCreateRate(request(), CURRENT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('Supersede its rate instead');
  });

  it('refuses a blank code, a blank description, and a blank reason', () => {
    expect(planCreateRate(request({ code: '  ' }), undefined).ok).toBe(false);
    expect(planCreateRate(request({ description: ' ' }), undefined).ok).toBe(false);
    expect(planCreateRate(request({ reason: '' }), undefined).ok).toBe(false);
  });

  it('refuses an LME-linked code with no drawing premium', () => {
    // It prices off copper plus a premium; without one it prices off nothing.
    const result = planCreateRate(request({ lmeLinked: true }), undefined);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PREMIUM_MISMATCH');
  });

  it('accepts an LME-linked code that states its premium', () => {
    const result = planCreateRate(
      request({ lmeLinked: true, drawingPremium: dec('0.42') }),
      undefined,
    );
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.lmeLinked).toBe(true);
    expect(result.value.drawingPremium?.toString()).toBe('0.42');
  });

  it('never marks a machine LME-linked', () => {
    // Machine time does not price off copper, whatever the form submits.
    const result = planCreateRate(
      request({ kind: 'machine', lmeLinked: true, drawingPremium: dec('1') }),
      undefined,
    );
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.lmeLinked).toBe(false);
    expect(result.value.drawingPremium).toBeNull();
  });

  it('defaults the unit sensibly per kind', () => {
    const material = planCreateRate(request({ uom: '' }), undefined);
    const machine = planCreateRate(request({ kind: 'machine', uom: '' }), undefined);
    if (!material.ok || !machine.ok) throw new Error('expected both');
    expect(material.value.uom).toBe('kg');
    expect(machine.value.uom).toBe('hour');
  });
});

describe('planAmendRate', () => {
  const request = (over: Partial<Parameters<typeof planAmendRate>[0]> = {}) => ({
    kind: 'material' as const,
    code: 'XSAUINS',
    description: 'Renamed material',
    uom: 'kg',
    at: LATER,
    reason: 'Supplier renamed the grade.',
    actor: ACTOR,
    ...over,
  });

  it('carries the rate forward untouched', () => {
    // The rule that keeps this from being a back door: an amendment changes
    // what a code *is*, never what it costs.
    const result = planAmendRate(request(), CURRENT);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.open.value.toString()).toBe(CURRENT.row.value.toString());
  });

  it('closes the old row exactly where the new one opens', () => {
    const result = planAmendRate(request(), CURRENT);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.close.validTo).toEqual(result.value.open.validFrom);
  });

  it('refuses a code the master does not hold', () => {
    const result = planAmendRate(request(), undefined);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('UNKNOWN_CODE');
  });

  it('refuses an amendment that changes nothing', () => {
    const result = planAmendRate(
      request({ description: CURRENT.description, uom: CURRENT.uom }),
      CURRENT,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NO_CHANGE');
  });

  it('refuses an instant at or before the row in force', () => {
    const result = planAmendRate(request({ at: CURRENT.row.validFrom }), CURRENT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOT_LATER');
  });

  it('refuses linking to the LME without a premium', () => {
    const result = planAmendRate(request({ lmeLinked: true }), CURRENT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PREMIUM_MISMATCH');
  });

  it('names what changed, so the audit row reads without a diff', () => {
    const result = planAmendRate(
      request({ description: 'Renamed material', uom: 'm' }),
      CURRENT,
    );
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.audit.next).toContain('description →');
    expect(result.value.audit.next).toContain('uom → m');
  });
});
