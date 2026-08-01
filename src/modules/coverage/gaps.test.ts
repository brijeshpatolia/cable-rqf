import { describe, expect, it } from 'vitest';
import { dec } from '@/core/decimal';
import type { ExtractedLine, LineStatus } from '@/modules/matching';
import { gapsOf, type GapLine } from './gaps';

/*
  The table exists to answer one question: when a line does not price, is it
  because we could not read it, or because we do not make it? Those have
  opposite remedies — a better reader, or a wider range — and a percentage
  cannot tell them apart. Most of what follows is about that split.
*/

const field = <T>(value: T | null, sourceText = '') => ({ value, sourceText });

function extracted(over: Partial<ExtractedLine> = {}): ExtractedLine {
  return {
    raw: '3C x 185mm2 XLPE SWA PVC 11kV — 12,000 m',
    cores: field<number>(3),
    sizeMm2: field(dec(185)),
    quantityMetres: field(dec(12000)),
    conductor: field('Cu'),
    insulation: field('XLPE'),
    screen: field<string>(null),
    armour: field('SWA'),
    sheath: field('PVC'),
    voltage: field('11kV'),
    standard: field<string>(null),
    unknownTerms: [],
    ...over,
  };
}

const line = (
  status: LineStatus,
  over: Partial<ExtractedLine> = {},
  customer: string | null = 'Al Hassan',
): GapLine => ({ status, extracted: extracted(over), customer });

describe('gapsOf', () => {
  it('ignores lines the library did price', () => {
    const g = gapsOf([line('exact'), line('close'), line('chosen'), line('hand-priced')]);
    expect(g.rows).toEqual([]);
    expect(g.notInLibrary).toBe(0);
    expect(g.unreadable).toBe(0);
  });

  it('separates a reader problem from a catalogue problem', () => {
    /*
      The distinction the whole table is for. Both lines are No-match; only one
      of them is an argument for adding a product.
    */
    const g = gapsOf([
      line('no-match'),
      line('partial', { cores: field<number>(null), sizeMm2: field(null) }),
    ]);

    expect(g.notInLibrary).toBe(1);
    expect(g.unreadable).toBe(1);
    expect(g.rows.map((r) => r.kind).sort()).toEqual(['not-in-library', 'unreadable']);
  });

  it('counts a line with no size as unreadable, not as a missing product', () => {
    // Cores read, size did not. Nothing could have matched it whatever the
    // library holds, so claiming it as demand for a product would be wrong.
    const g = gapsOf([line('no-match', { sizeMm2: field(null) })]);
    expect(g.unreadable).toBe(1);
    expect(g.notInLibrary).toBe(0);
    expect(g.rows[0]!.label).toBe('Cores or size not readable');
  });

  it('groups two spellings of one cable into one gap', () => {
    /*
      The reason this groups on the parsed spec rather than the raw text. Two
      customers writing the same cable differently is one gap asked for twice,
      and reporting it as two rows would bury both.
    */
    const g = gapsOf([
      line('no-match', { raw: '3C x 185mm2 XLPE SWA PVC 11kV' }, 'Al Hassan'),
      line('no-match', { raw: '3 core 185 sq mm XLPE SWA PVC 11 kV' }, 'Muscat Electrical'),
    ]);

    expect(g.rows).toHaveLength(1);
    expect(g.rows[0]!.lines).toBe(2);
    expect(g.rows[0]!.customers).toBe(2);
    expect(g.rows[0]!.metres.toString()).toBe('24000');
  });

  it('does not merge cables that differ on a real axis', () => {
    const g = gapsOf([
      line('no-match'),
      line('no-match', { sizeMm2: field(dec(240)) }),
      line('no-match', { voltage: field('33kV') }),
    ]);
    expect(g.rows).toHaveLength(3);
  });

  it('ranks by metres, so one long line outweighs several short ones', () => {
    const g = gapsOf([
      line('no-match', { sizeMm2: field(dec(240)), quantityMetres: field(dec(12000)) }),
      line('no-match', { quantityMetres: field(dec(50)) }),
      line('no-match', { quantityMetres: field(dec(60)) }),
      line('no-match', { quantityMetres: field(dec(70)) }),
    ]);

    expect(g.rows[0]!.label).toContain('240mm²');
    expect(g.rows[0]!.metres.toString()).toBe('12000');
    expect(g.rows[1]!.lines).toBe(3);
  });

  it('states unreadable quantities rather than counting them as zero', () => {
    /*
      A gap whose quantities could not be read would otherwise sink to the
      bottom of a ranking by metres and look unimportant. The count is carried
      so the row can say so on its face.
    */
    const g = gapsOf([
      line('no-match', { quantityMetres: field(null) }),
      line('no-match', { quantityMetres: field(dec(500)) }),
    ]);

    expect(g.rows[0]!.lines).toBe(2);
    expect(g.rows[0]!.withoutQuantity).toBe(1);
    expect(g.rows[0]!.metres.toString()).toBe('500');
  });

  it('labels a gap the way an engineer would say it', () => {
    const g = gapsOf([line('no-match')]);
    expect(g.rows[0]!.label).toBe('3C × 185mm² · Cu · 11kV · XLPE/SWA/PVC');
  });

  it('keeps aluminium apart from copper, which is a different finding', () => {
    /*
      The library is copper only, so an aluminium request is a no-match on the
      conductor alone — "we do not make that metal", not "we do not make that
      size". Merged, the table reported a copper gap illustrated by an
      aluminium enquiry and would have argued for adding the wrong product.
    */
    const g = gapsOf([
      line('no-match', { raw: '3C x 50mm2 Cu XLPE SWA PVC 1kV' }),
      line('no-match', {
        raw: '3C x 50mm2 aluminium XLPE SWA PVC 1kV',
        conductor: field('Al'),
      }),
    ]);

    expect(g.rows).toHaveLength(2);
    expect(g.rows.map((r) => r.label).sort()).toEqual([
      '3C × 185mm² · Al · 11kV · XLPE/SWA/PVC',
      '3C × 185mm² · Cu · 11kV · XLPE/SWA/PVC',
    ]);
  });

  it('leaves out parts of the construction the customer never mentioned', () => {
    // A blank screen is silence, not a request for an unscreened cable.
    const g = gapsOf([line('no-match', { armour: field(null), sheath: field(null) })]);
    expect(g.rows[0]!.label).toBe('3C × 185mm² · Cu · 11kV · XLPE');
  });

  it('keeps a customer phrasing so the row is recognisable', () => {
    const g = gapsOf([line('no-match', { raw: '  3C x 185mm2 11kV, 12km  ' })]);
    expect(g.rows[0]!.example).toBe('3C x 185mm2 11kV, 12km');
  });

  it('counts an unnamed customer as nobody rather than as someone', () => {
    const g = gapsOf([line('no-match', {}, null), line('no-match', {}, '')]);
    expect(g.rows[0]!.lines).toBe(2);
    expect(g.rows[0]!.customers).toBe(0);
  });

  it('agrees with coverageOf on which tiers are uncovered', () => {
    /*
      Both count `partial` and `no-match` and neither counts `hand-priced`.
      If the two ever disagreed, the screen would report a percentage and a
      list that contradict each other.
    */
    const all: LineStatus[] = [
      'exact',
      'close',
      'chosen',
      'hand-priced',
      'partial',
      'no-match',
    ];
    const g = gapsOf(all.map((s) => line(s)));
    expect(g.notInLibrary + g.unreadable).toBe(2);
  });
});
