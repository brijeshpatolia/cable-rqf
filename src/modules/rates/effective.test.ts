import { describe, expect, it } from 'vitest';
import { dec } from '@/core/decimal';
import {
  type EffectiveRow,
  findOverlaps,
  resolveAllAt,
  resolveAt,
  supersede,
} from './effective';

const d = (iso: string) => new Date(iso);

const row = (
  key: string,
  value: string,
  from: string,
  to: string | null,
  id: string,
): EffectiveRow<ReturnType<typeof dec>> => ({
  key,
  value: dec(value),
  validFrom: d(from),
  validTo: to === null ? null : d(to),
  rateId: id,
  table: 'material_rate',
});

const rows = [
  row('XLPE', '1.100', '2026-01-01', '2026-04-01', 'r1'),
  row('XLPE', '1.180', '2026-04-01', null, 'r2'),
  row('PVC', '0.510', '2026-01-01', null, 'r3'),
];

describe('effective dating', () => {
  it('resolves the row in force at an instant', () => {
    expect(resolveAt(rows, 'XLPE', d('2026-02-01'))?.rateId).toBe('r1');
    expect(resolveAt(rows, 'XLPE', d('2026-07-01'))?.rateId).toBe('r2');
  });

  it('treats validFrom as inclusive and validTo as exclusive', () => {
    expect(resolveAt(rows, 'XLPE', d('2026-04-01'))?.rateId).toBe('r2');
    expect(resolveAt(rows, 'XLPE', d('2026-03-31T23:59:59Z'))?.rateId).toBe('r1');
  });

  it('returns nothing for an instant before any row — it does not fall back', () => {
    expect(resolveAt(rows, 'XLPE', d('2025-06-01'))).toBeUndefined();
  });

  it('reconstructs a historic instant and today through the same call', () => {
    const march = resolveAllAt(rows, d('2026-03-01'));
    const july = resolveAllAt(rows, d('2026-07-01'));
    expect(march.get('XLPE')?.value.toFixed(3)).toBe('1.100');
    expect(july.get('XLPE')?.value.toFixed(3)).toBe('1.180');
    expect(march.get('PVC')?.value.toFixed(3)).toBe('0.510');
  });

  it('finds no overlap in a well-formed table', () => {
    expect(findOverlaps(rows)).toHaveLength(0);
  });

  it('detects overlapping periods for the same key', () => {
    const bad = [...rows, row('XLPE', '1.250', '2026-02-01', null, 'r4')];
    const overlaps = findOverlaps(bad);
    expect(overlaps.length).toBeGreaterThan(0);
    expect(overlaps[0]!.key).toBe('XLPE');
  });

  it('supersedes by closing the old row, never overwriting it', () => {
    const next = supersede(rows, 'PVC', dec('0.545'), d('2026-07-24'), 'r9');

    // The old row still exists, now closed.
    const old = next.find((r) => r.rateId === 'r3');
    expect(old?.value.toFixed(3)).toBe('0.510');
    expect(old?.validTo).toEqual(d('2026-07-24'));

    // And the historic answer is unchanged.
    expect(resolveAt(next, 'PVC', d('2026-03-01'))?.value.toFixed(3)).toBe('0.510');
    expect(resolveAt(next, 'PVC', d('2026-08-01'))?.value.toFixed(3)).toBe('0.545');
    expect(findOverlaps(next)).toHaveLength(0);
  });
});
