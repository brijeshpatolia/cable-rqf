import { describe, expect, it } from 'vitest';
import type { AuditEvent } from '@/modules/rates';
import { ABSENT, changeOf, fieldLabel, kindsIn, matches, subjectOf } from './index';

/**
 * Reading the trail back.
 *
 * The rule under test throughout: nothing is dropped. A row the app cannot
 * classify still appears, because a history that quietly omits what it does
 * not understand is worse than one that shows it awkwardly — the only reason
 * to keep an audit trail is that it is complete.
 */

const event = (over: Partial<AuditEvent> = {}): AuditEvent => ({
  at: new Date('2026-07-25T10:00:00Z'),
  actor: 'owner@nuhas.example',
  entity: 'material_rate:ABPT025',
  field: 'rate',
  previous: '1.836',
  next: '0.700',
  ...over,
});

describe('subjectOf', () => {
  it('names the things the app actually writes', () => {
    expect(subjectOf('material_rate:ABPT025')).toEqual({
      kind: 'material',
      label: 'Material rate',
      name: 'ABPT025',
    });
    expect(subjectOf('quote:Q-2026-0004').label).toBe('Quote');
    expect(subjectOf('job:J-2026-0015').label).toBe('Enquiry');
    expect(subjectOf('product:C07C02F2XLLWLKNA').name).toBe('C07C02F2XLLWLKNA');
    expect(subjectOf('vocabulary:sheath').kind).toBe('vocabulary');
    expect(subjectOf('app_user:owner@nuhas.example').kind).toBe('account');
  });

  it('handles a singleton entity with no name after it', () => {
    expect(subjectOf('lme_price')).toEqual({
      kind: 'copper',
      label: 'Copper price',
      name: '',
    });
  });

  it('keeps an unrecognised entity whole rather than hiding it', () => {
    // The point of the trail is that nothing is missing from it. A prefix this
    // does not know about is a screen problem, never a reason to drop a row.
    expect(subjectOf('something_new:42')).toEqual({
      kind: 'other',
      label: 'Other',
      name: 'something_new:42',
    });
  });

  it('does not lose a name containing a colon', () => {
    expect(subjectOf('app_user:a:b@x.com').name).toBe('a:b@x.com');
  });
});

describe('fieldLabel', () => {
  it('says what was changed in words', () => {
    expect(fieldLabel('job:J-2026-0015', 'raw_text')).toBe('enquiry text');
    expect(fieldLabel('material_rate:X', 'drawing_premium')).toBe('drawing premium');
  });

  it('reads a vocabulary row’s field as the phrase it is', () => {
    // The dictionary stores the taught phrase *in* the field, so labelling it
    // as a column name would render "xlpo" as though it were a database term.
    expect(fieldLabel('vocabulary:sheath', 'xlpo')).toBe('the phrase “xlpo”');
  });

  it('counts enquiry lines from one, the way the screen does', () => {
    expect(fieldLabel('job:J-2026-0015', 'line:0')).toBe('line 1');
    expect(fieldLabel('job:J-2026-0015', 'line:3')).toBe('line 4');
  });

  it('falls through readably rather than inventing a label', () => {
    expect(fieldLabel('quote:Q-1', 'some_new_column')).toBe('some new column');
  });
});

describe('changeOf', () => {
  it('carries the whole row, reason included', () => {
    const c = changeOf(event({ reason: 'Supplier price fell.' }));
    expect(c.subject.name).toBe('ABPT025');
    expect(c.what).toBe('rate');
    expect(c.from).toBe('1.836');
    expect(c.to).toBe('0.700');
    expect(c.reason).toBe('Supplier price fell.');
  });

  it('says nothing was there before rather than showing a blank', () => {
    const c = changeOf(event({ previous: '' }));
    expect(c.from).toBe(ABSENT);
  });

  it('keeps a missing reason as null, not as an empty sentence', () => {
    expect(changeOf(event()).reason).toBeNull();
  });
});

describe('kindsIn', () => {
  it('reports each kind once, for the filter chips', () => {
    expect(
      kindsIn([
        event(),
        event({ entity: 'material_rate:OTHER' }),
        event({ entity: 'quote:Q-2026-0001' }),
      ]),
    ).toEqual(['material', 'quote']);
  });
});

describe('matches', () => {
  const row = event({ entity: 'job:J-2026-0015', field: 'raw_text', reason: 'Typo in line 3.' });

  it('finds a row by anything a person would remember about it', () => {
    expect(matches(row, 'J-2026-0015')).toBe(true);
    expect(matches(row, 'enquiry')).toBe(true);
    expect(matches(row, 'typo')).toBe(true);
    expect(matches(row, 'owner@')).toBe(true);
  });

  it('does not search the values themselves', () => {
    // Searching "0.7" would otherwise surface every rate that happens to
    // contain those digits — noise dressed as a result.
    expect(matches(event({ next: '0.700' }), '0.700')).toBe(false);
  });

  it('an empty query matches everything', () => {
    expect(matches(row, '   ')).toBe(true);
  });
});
