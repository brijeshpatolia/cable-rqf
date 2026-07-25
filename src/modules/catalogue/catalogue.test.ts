import { describe, expect, it } from 'vitest';
import { dec } from '@/core/decimal';
import { omrPerKm } from '@/core/units';
import type { Actor } from '@/modules/auth';
import { products } from '@/infra/data';
import {
  type Design,
  type KnownCodes,
  designationFor,
  planCreateProduct,
  planRevise,
} from './index';

/**
 * What the catalogue refuses.
 *
 * Every rule here has the same justification: a design that points at a code
 * with no rate, or carries a quantity nobody can cost, is not a design the
 * engine can price. Saying so when somebody types it beats discovering it on
 * the next quote — which is the whole discipline of this app applied one level
 * further back.
 */

const ACTOR: Actor = {
  id: 'u1',
  email: 'owner@nuhas.example',
  name: 'B. Patolia',
  role: 'rateOwner',
};

const AT = new Date('2026-07-25T09:00:00Z');
const PRODUCT = products()[0]!;

const KNOWN: KnownCodes = {
  materials: new Set(['CC1F', 'XSAUINS', 'LSF1']),
  machines: new Set(['EX-90R1', 'ARM-48BN']),
};

const design = (over: Partial<Design> = {}): Design => ({
  bom: [
    { materialKey: 'CC1F', materialName: 'Copper', consumption: dec('1227'), scrap: dec('6.135') },
    { materialKey: 'XSAUINS', materialName: 'XLPE', consumption: dec('87.6'), scrap: dec('4.38') },
  ],
  operations: [
    { machineKey: 'EX-90R1', machineName: 'Extruder', hoursPerKm: dec('0.99'), cores: dec('3') },
  ],
  overheads: [{ key: 'admin', name: 'Admin', amount: dec('18.25') }],
  toolingPerKm: dec('1.5'),
  ...over,
});

const revise = (over: Partial<Parameters<typeof planRevise>[0]> = {}) => ({
  product: PRODUCT,
  design: design(),
  known: KNOWN,
  reason: 'Supplier changed the XLPE grade.',
  actor: ACTOR,
  at: AT,
  ...over,
});

describe('planRevise', () => {
  it('keeps the item code, which is the point of a revision', () => {
    const result = planRevise(revise());
    if (!result.ok) throw new Error(result.error.message);
    // Nothing in a revision can change what the cable *is* — so it can never
    // quietly turn a 3-core into a 4-core and reprice every enquiry that
    // matched it.
    expect(result.value.code).toBe(PRODUCT.id);
    expect(result.value.productId).toBe(PRODUCT.id);
  });

  it('refuses a revision with no reason', () => {
    const result = planRevise(revise({ reason: '  ' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NO_REASON');
  });

  it('refuses a material the master does not hold', () => {
    const result = planRevise(
      revise({
        design: design({
          bom: [
            { materialKey: 'NOSUCH', materialName: '?', consumption: dec('1'), scrap: dec('0') },
          ],
        }),
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('UNKNOWN_MATERIAL');
      // And says what to do about it.
      expect(result.error.message).toContain('Add it there first');
    }
  });

  it('refuses a machine the master does not hold', () => {
    const result = planRevise(
      revise({
        design: design({
          operations: [
            { machineKey: 'GHOST', machineName: '?', hoursPerKm: dec('1'), cores: dec('1') },
          ],
        }),
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('UNKNOWN_MACHINE');
  });

  it('refuses a bill of materials with nothing on it', () => {
    const result = planRevise(revise({ design: design({ bom: [] }) }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NO_MATERIALS');
  });

  it('refuses the same material twice, because it would cost in two places', () => {
    const result = planRevise(
      revise({
        design: design({
          bom: [
            { materialKey: 'CC1F', materialName: 'Copper', consumption: dec('1'), scrap: dec('0') },
            { materialKey: 'cc1f', materialName: 'Copper', consumption: dec('2'), scrap: dec('0') },
          ],
        }),
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('DUPLICATE_LINE');
  });

  it('allows a machine to run twice in one route, at different hours', () => {
    // Drawing then re-drawing is a real route, not double-counting.
    const result = planRevise(
      revise({
        design: design({
          operations: [
            { machineKey: 'EX-90R1', machineName: 'Extruder', hoursPerKm: dec('0.9'), cores: dec('3') },
            { machineKey: 'EX-90R1', machineName: 'Extruder', hoursPerKm: dec('1.4'), cores: dec('1') },
          ],
        }),
      }),
    );
    expect(result.ok).toBe(true);
  });

  it('refuses the same stage twice at identical hours — that is double-counting', () => {
    const op = {
      machineKey: 'EX-90R1',
      machineName: 'Extruder',
      hoursPerKm: dec('0.9'),
      cores: dec('3'),
    };
    const result = planRevise(revise({ design: design({ operations: [op, op] }) }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('DUPLICATE_LINE');
  });

  it('refuses quantities the engine cannot cost', () => {
    const bad = (over: Partial<Design>) => planRevise(revise({ design: design(over) })).ok;

    expect(
      bad({ bom: [{ materialKey: 'CC1F', materialName: 'Cu', consumption: dec('0'), scrap: dec('0') }] }),
    ).toBe(false);
    expect(
      bad({ bom: [{ materialKey: 'CC1F', materialName: 'Cu', consumption: dec('1'), scrap: dec('-1') }] }),
    ).toBe(false);
    expect(
      bad({
        operations: [
          { machineKey: 'EX-90R1', machineName: 'E', hoursPerKm: dec('1'), cores: dec('0') },
        ],
      }),
    ).toBe(false);
    expect(bad({ toolingPerKm: dec('-1') })).toBe(false);
  });

  it('upper-cases codes, so a design cannot miss a rate on casing alone', () => {
    const result = planRevise(
      revise({
        design: design({
          bom: [
            { materialKey: ' cc1f ', materialName: 'Cu', consumption: dec('1'), scrap: dec('0') },
          ],
        }),
      }),
    );
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.design.bom[0]?.materialKey).toBe('CC1F');
  });

  it('names what changed, so the audit row reads without a diff', () => {
    const result = planRevise(revise());
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.audit.next).toMatch(/materials|stages|quantit|tooling/);
    expect(result.value.audit.reason).toBe('Supplier changed the XLPE grade.');
  });
});

describe('planCreateProduct', () => {
  const SPEC = {
    cores: 3,
    sizeMm2: dec('50'),
    conductor: 'Cu',
    insulation: 'XLPE',
    screen: '',
    armour: 'SWA',
    sheath: 'PVC',
    voltage: '33kV',
    standard: 'IEC 60502-2',
  };

  const create = (over: Partial<Parameters<typeof planCreateProduct>[0]> = {}) => ({
    code: 'NEWCABLE01',
    spec: SPEC,
    family: 'MV CABLE',
    design: design(),
    known: KNOWN,
    existingCodes: new Set([PRODUCT.id]),
    reason: 'Won a 33 kV build; adding the item code.',
    actor: ACTOR,
    ...over,
  });

  it('creates an item and composes its designation from the construction', () => {
    const result = planCreateProduct(create());
    if (!result.ok) throw new Error(result.error.message);

    expect(result.value.code).toBe('NEWCABLE01');
    expect(result.value.designation).toContain('3Cx50 mm2');
    expect(result.value.designation).toContain('33kV');
    expect(result.value.designation).toContain('SWA');
    // The empty screen does not leave a gap in the middle of the name.
    expect(result.value.designation).not.toContain('  ');
  });

  it('refuses a code the library already holds', () => {
    const result = planCreateProduct(create({ code: PRODUCT.id }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('CODE_TAKEN');
      expect(result.error.message).toContain('Revise its design instead');
    }
  });

  it('refuses a construction the matcher could not compare', () => {
    // These are the fields `matchLine` keys on. A cable missing one of them
    // would never match anything, which is a worse outcome than a refusal now.
    expect(planCreateProduct(create({ spec: { ...SPEC, cores: 0 } })).ok).toBe(false);
    expect(planCreateProduct(create({ spec: { ...SPEC, sizeMm2: dec('0') } })).ok).toBe(false);
    expect(planCreateProduct(create({ spec: { ...SPEC, conductor: '' } })).ok).toBe(false);
    expect(planCreateProduct(create({ spec: { ...SPEC, voltage: ' ' } })).ok).toBe(false);
  });

  it('refuses a fractional core count', () => {
    const result = planCreateProduct(create({ spec: { ...SPEC, cores: 3.5 } }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('BAD_SPEC');
  });

  it('applies the same design rules as a revision', () => {
    const result = planCreateProduct(create({ design: design({ bom: [] }) }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NO_MATERIALS');
  });

  it('accepts a designation typed by hand over the composed one', () => {
    const result = planCreateProduct(create({ designation: 'Special build for Muscat' }));
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.designation).toBe('Special build for Muscat');
  });
});

describe('designationFor', () => {
  it('omits the fields a cable does not have', () => {
    const name = designationFor(
      {
        cores: 1,
        sizeMm2: dec('630'),
        conductor: 'Cu',
        insulation: 'XLPE',
        screen: '',
        armour: '',
        sheath: 'PVC',
        voltage: '1kV',
        standard: '',
      },
      'LV CABLE',
    );
    expect(name).toBe('LV CABLE - 1Cx630 mm2 - Cu - XLPE - PVC - 1kV');
  });
});

/** The engine's own unit brand, to prove a plan is engine-shaped. */
describe('a revised design is something the engine can price', () => {
  it('produces lines shaped like the ones computeCost consumes', () => {
    const result = planRevise(revise());
    if (!result.ok) throw new Error(result.error.message);

    // Not a deep costing test — the parity harness does that. This pins the
    // shape, so a plan cannot drift from what the engine reads.
    const line = result.value.design.bom[0]!;
    expect(line.consumption.plus(line.scrap).greaterThan(0)).toBe(true);
    expect(omrPerKm(result.value.design.toolingPerKm).greaterThanOrEqualTo(0)).toBe(true);
  });
});
