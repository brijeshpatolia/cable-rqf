import { describe, expect, it } from 'vitest';
import { products } from '@/infra/data';
import { parseLine } from './parse';
import { isPriceable, matchLine, type SubstitutionRule } from './match';

/**
 * Matching, tested against the real imported library rather than fixtures —
 * the tiers only mean anything relative to what Nuhas actually holds.
 */
const LIBRARY = products();

const tierOf = (text: string) => matchLine(parseLine(text), LIBRARY).tier;

describe('parsing', () => {
  it('reads cores, size, and quantity from an ordinary line', () => {
    const l = parseLine('3C x 50mm2 Cu XLPE SWA PVC 1kV — 12,000 m');
    expect(l.cores.value).toBe(3);
    expect(l.sizeMm2.value?.toString()).toBe('50');
    expect(l.quantityMetres.value?.toString()).toBe('12000');
    expect(l.conductor.value).toBe('Cu');
    expect(l.insulation.value).toBe('XLPE');
    expect(l.armour.value).toBe('SWA');
    expect(l.sheath.value).toBe('PVC');
    expect(l.voltage.value).toBe('1kV');
  });

  it('normalises however the customer wrote it', () => {
    const l = parseLine(
      '3 core x 50 sq mm copper, cross linked polyethylene, steel wire armoured, p.v.c, 0.6/1kV',
    );
    expect(l.conductor.value).toBe('Cu');
    expect(l.insulation.value).toBe('XLPE');
    expect(l.armour.value).toBe('SWA');
    expect(l.voltage.value).toBe('1kV');
  });

  it('doubles pairs into cores, which is what the library holds', () => {
    expect(parseLine('10 Pair x 1.5mm2 Cu XLPE IOSCR FRRT PVC SWA 500V').cores.value).toBe(20);
  });

  it('converts kilometres to metres', () => {
    expect(parseLine('3C x 50mm2 1kV, 2.5 km').quantityMetres.value?.toString()).toBe('2500');
  });

  it('does not read a quantity as a size', () => {
    const l = parseLine('4C x 16mm2 Cu XLPE SWA PVC 1kV 12000 m');
    expect(l.sizeMm2.value?.toString()).toBe('16');
    expect(l.quantityMetres.value?.toString()).toBe('12000');
  });

  it('prefers the longest phrase — "steel wire armoured" is not "steel"', () => {
    expect(parseLine('3C x 50mm2 steel wire armoured 1kV').armour.value).toBe('SWA');
  });

  it('leaves a field empty rather than guessing when it is ambiguous', () => {
    // Two armour terms in one line is not a cable anyone can price.
    expect(parseLine('3C x 50mm2 Cu XLPE SWA AWA PVC 1kV').armour.value).toBeNull();
  });

  it('flags wording it does not recognise instead of inventing a meaning', () => {
    const l = parseLine('3C x 50mm2 Cu XLPE SWA PVC 1kV with unobtainium bedding');
    expect(l.unknownTerms).toContain('unobtainium');
  });
});

describe('tiers', () => {
  it('matches a real library product exactly', () => {
    const real = LIBRARY.find((p) => p.spec.armour === 'SWA' && p.spec.sheath === 'PVC')!;
    const s = real.spec;
    const line = `${s.cores}C x ${s.sizeMm2.toString()}mm2 ${s.conductor} ${s.insulation} ${s.screen} ${s.armour} ${s.sheath} ${s.voltage}`;

    const result = matchLine(parseLine(line), LIBRARY);
    expect(result.tier).toBe('exact');
    if (result.tier === 'exact') expect(result.product.spec.cores).toBe(s.cores);
  });

  it('rejects aluminium outright — the library is copper only', () => {
    const result = matchLine(
      parseLine('3C x 50mm2 aluminium XLPE SWA PVC 1kV'),
      LIBRARY,
    );
    expect(result.tier).toBe('no-match');
    if (result.tier === 'no-match') expect(result.reason).toContain('copper only');
  });

  it('offers the item codes at this size when the voltage is unheld', () => {
    /*
      This used to be a flat No-match with nothing offered, and it was wrong.
      33 kV is a *line* voltage for what Nuhas costs as a 30 kV cable: the
      copper is identical, and the library holds five item codes at 3-core
      50 mm². A dead end there leaves an engineer with a red row and nothing to
      do about it, when the answer was in the catalogue all along.

      The app still will not price it — the tier says Partial, not Close.
      Picking the right code stays a person's decision.
    */
    const result = matchLine(parseLine('3C x 50mm2 Cu XLPE SWA PVC 33kV'), LIBRARY);
    expect(result.tier).toBe('partial');
    if (result.tier !== 'partial') return;

    expect(result.reason).toContain('33kV');
    const sameBuild = result.nearest.filter((c) => c.sameBuild);
    expect(sameBuild.length).toBeGreaterThan(1);

    // Every one of them really is the enquiry's core count and size.
    for (const c of sameBuild) {
      expect(c.product.spec.cores).toBe(3);
      expect(Number(c.product.spec.sizeMm2.toString())).toBe(50);
    }
    // Including the 30 kV cable, which is the one an engineer would pick.
    expect(sameBuild.map((c) => c.product.spec.voltage)).toContain('30kV');
  });

  it('still refuses a voltage where nothing at that build is held', () => {
    const result = matchLine(parseLine('7C x 999mm2 Cu XLPE SWA PVC 33kV'), LIBRARY);
    expect(result.tier).toBe('no-match');
    if (result.tier === 'no-match') {
      expect(result.reason).toContain('nothing is held');
    }
  });

  it('offers copper candidates on an aluminium line without pretending it matches', () => {
    // The app will not price a different conductor — different cable, different
    // cost basis. But an engineer may well quote the copper equivalent, and
    // showing nothing helps nobody.
    const result = matchLine(
      parseLine('3C x 50mm2 aluminium XLPE SWA PVC 1kV'),
      LIBRARY,
    );
    expect(result.tier).toBe('no-match');
    if (result.tier !== 'no-match') return;

    expect(result.reason).toContain('copper only');
    expect(result.nearest.filter((c) => c.sameBuild).length).toBeGreaterThan(0);
  });

  it('ranks a different-build candidate by nearest cable, not fewest fields', () => {
    /*
      A regression this caught: ranking by "fewest differing fields" offered a
      2.5 mm² product to a 55 mm² enquiry, because it happened to agree on more
      of the finish. Picking it would have quoted the wrong copper entirely.
    */
    const result = matchLine(parseLine('3C x 55mm2 Cu XLPE SWA PVC 1kV'), LIBRARY);
    expect(result.tier).toBe('partial');
    if (result.tier !== 'partial') return;

    const first = result.nearest[0];
    expect(first).toBeDefined();
    expect(Number(first!.product.spec.sizeMm2.toString())).toBe(50);
    expect(first!.product.spec.cores).toBe(3);
  });

  it('marks an in-between size Partial and shows the nearest products', () => {
    const result = matchLine(parseLine('3C x 55mm2 Cu XLPE SWA PVC 1kV'), LIBRARY);
    expect(result.tier).toBe('partial');
    if (result.tier === 'partial') {
      expect(result.nearest.length).toBeGreaterThan(0);
      expect(result.reason).toContain('size');
    }
  });

  it('marks a core count outside the library Partial, never priced', () => {
    const result = matchLine(parseLine('6C x 50mm2 Cu XLPE SWA PVC 1kV'), LIBRARY);
    expect(result.tier).toBe('partial');
    expect(isPriceable(result)).toBe(false);
  });

  it('pauses on unfamiliar wording instead of matching around it', () => {
    const result = matchLine(
      parseLine('3C x 50mm2 Cu XLPE SWA PVC 1kV with unobtainium bedding'),
      LIBRARY,
    );
    expect(result.tier).toBe('partial');
    if (result.tier === 'partial') expect(result.reason).toContain('Unfamiliar wording');
  });

  it('refuses to price when a field could not be read', () => {
    const result = matchLine(parseLine('some cable, 12000 m'), LIBRARY);
    expect(isPriceable(result)).toBe(false);
  });

  it('ships with no substitution rules, so nothing is tiered Close by default', () => {
    // The allowlist is the Rate Owner's to grow. Until they do, a line that
    // would be Close falls to Partial rather than being priced on a guess.
    const tiers = new Set(
      LIBRARY.slice(0, 20).map((p) => {
        const s = p.spec;
        return tierOf(
          `${s.cores}C x ${s.sizeMm2.toString()}mm2 ${s.conductor} ${s.insulation} ${s.screen} ${s.armour} LSOH ${s.voltage}`,
        );
      }),
    );
    expect(tiers.has('close')).toBe(false);
  });

  it('tiers Close only once the Rate Owner declares a substitution safe', () => {
    const pvc = LIBRARY.find(
      (p) => p.spec.sheath === 'PVC' && p.spec.armour === 'SWA' && p.spec.screen === '',
    )!;
    const s = pvc.spec;
    const line = `${s.cores}C x ${s.sizeMm2.toString()}mm2 ${s.conductor} ${s.insulation} ${s.armour} LSOH ${s.voltage}`;

    const rule: SubstitutionRule = {
      axis: 'sheath',
      from: 'PVC',
      to: 'LSOH',
      rationale: 'LSOH is a drop-in sheath change on the same construction.',
    };

    const before = matchLine(parseLine(line), LIBRARY);
    const after = matchLine(parseLine(line), LIBRARY, { substitutions: [rule] });

    expect(before.tier).toBe('partial');
    expect(after.tier).toBe('close');
    if (after.tier === 'close') {
      expect(after.difference.axis).toBe('sheath');
      expect(after.substitution.rationale).toBe(rule.rationale);
    }
  });

  it('never treats a core-parameter difference as Close, whatever the rules say', () => {
    const rule: SubstitutionRule = {
      axis: 'cores',
      from: '3',
      to: '4',
      rationale: 'Deliberately unsafe rule, to prove the guard holds.',
    };
    const result = matchLine(
      parseLine('4C x 50mm2 Cu XLPE SWA PVC 1kV'),
      LIBRARY.filter((p) => p.spec.cores === 3),
      { substitutions: [rule] },
    );
    expect(result.tier).not.toBe('close');
  });
});
