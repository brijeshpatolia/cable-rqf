import { describe, expect, it } from 'vitest';
import { BUILT_IN_TERMS, parseLine } from '@/modules/matching';
import { type Candidate, containsPhrase, readCandidates, schemaFor, statesNumber } from './candidates';

/**
 * These tests are written from the model's side of the fence.
 *
 * The interesting question is never "does a good answer get through" — it is
 * what happens to a bad one. So most of what follows hands `readCandidates` an
 * answer that is wrong in a specific, plausible way and checks that the wrong
 * part is the part that gets thrown away.
 */

/** A cut-down MTO in the shape the reader was built for: heading, then rows. */
const DOCUMENT = [
  'SL. NO DESCRIPTION UNIT QTY',
  '600/1000V, STRANDED ANNEALED PLAIN COPPER CONDUCTOR, XLPE INSULATION, NON-HYGROSCOPIC FILLERS & BINDER TAPE (AS',
  '5',
  'REQUIRED), EXTRUDED PVC BEDDING, GALVANIZED STEEL ROUND WIRE ARMOUR AND OVERALL EXTRUDED PVC OUTER SHEATH',
  '5.1 2C X 16 mm² m 19000',
  '5.2 3C X 2.5 mm² m 4000',
  '5.3 4C X 50 mm² m 0',
].join('\n');

const HEADING =
  '600/1000V, STRANDED ANNEALED PLAIN COPPER CONDUCTOR, XLPE INSULATION, NON-HYGROSCOPIC FILLERS & BINDER TAPE (AS';
const ARMOUR_HALF =
  'REQUIRED), EXTRUDED PVC BEDDING, GALVANIZED STEEL ROUND WIRE ARMOUR AND OVERALL EXTRUDED PVC OUTER SHEATH';

const row51: Candidate = {
  itemRef: '5.1',
  cores: 2,
  sizeMm2: 16,
  quantity: 19000,
  quantityUnit: 'm',
  conductor: 'Cu',
  insulation: 'XLPE',
  screen: null,
  armour: 'SWA',
  sheath: 'PVC',
  voltage: '1kV',
  standard: null,
  evidence: { row: ['5.1 2C X 16 mm² m 19000'], heading: [HEADING, ARMOUR_HALF] },
};

const read = (candidates: readonly Candidate[], text = DOCUMENT) =>
  readCandidates({ candidates, text });

describe('a well-read row', () => {
  it('comes out as a line a person could have pasted', () => {
    expect(read([row51]).document.lines).toEqual([
      '2C x 16 mm² Cu XLPE SWA PVC 1kV — 19,000 m',
    ]);
  });

  it('is understood by the parser the paste box already uses', () => {
    const line = read([row51]).document.lines[0]!;
    const parsed = parseLine(line);

    expect(parsed.cores.value).toBe(2);
    expect(parsed.sizeMm2.value?.toString()).toBe('16');
    expect(parsed.quantityMetres.value?.toString()).toBe('19000');
    expect(parsed.conductor.value).toBe('Cu');
    expect(parsed.insulation.value).toBe('XLPE');
    expect(parsed.armour.value).toBe('SWA');
    expect(parsed.sheath.value).toBe('PVC');
    expect(parsed.voltage.value).toBe('1kV');
    expect(parsed.unknownTerms).toEqual([]);
  });

  it('keeps the item number, so the engineer can find the row', () => {
    expect(read([row51]).document.sources[0]).toEqual({
      line: 4,
      where: 'line 5, item 5.1',
    });
  });

  it('carries the construction from the heading three lines above it', () => {
    // The whole reason this file exists: nothing on row 5.1 says 600/1000V.
    expect(read([row51]).document.lines[0]).toContain('1kV');
  });
});

describe('an answer the document does not support', () => {
  it('drops a row quoting text that is not in the document', () => {
    const invented: Candidate = {
      ...row51,
      itemRef: '5.9',
      quantity: 7000,
      evidence: { row: ['5.9 2C X 16 mm² m 7000'], heading: [] },
    };
    const out = read([invented]).document;

    expect(out.lines).toEqual([]);
    expect(out.notes.join(' ')).toContain('does not appear in the document');
  });

  it('drops a row that quotes nothing at all', () => {
    const out = read([{ ...row51, evidence: { row: [], heading: [] } }]).document;

    expect(out.lines).toEqual([]);
    expect(out.notes.join(' ')).toContain('none of its own cells were quoted');
  });

  it('drops a quantity that was not printed, even when the row was', () => {
    // The dangerous shape: a real row, a plausible number, no such figure.
    const out = read([{ ...row51, quantity: 19500 }]).document;

    expect(out.lines).toEqual([]);
    expect(out.notes.join(' ')).toContain('no quantity is printed');
  });

  it('will not read a quantity out of a row number', () => {
    // `5.1` is on the row. 1 is not a quantity, and 5.1 is not one either.
    const out = read([{ ...row51, quantity: 1 }]).document;
    expect(out.lines).toEqual([]);
  });

  it('drops a size that was not printed', () => {
    const out = read([{ ...row51, sizeMm2: 25 }]).document;

    expect(out.lines).toEqual([]);
    expect(out.notes.join(' ')).toContain('no conductor size is printed');
  });

  it('leaves out a row the customer asked for none of', () => {
    const zero: Candidate = {
      ...row51,
      itemRef: '5.3',
      cores: 4,
      sizeMm2: 50,
      quantity: 0,
      evidence: { row: ['5.3 4C X 50 mm² m 0'], heading: [] },
    };
    const out = read([zero]).document;

    expect(out.lines).toEqual([]);
    expect(out.notes.join(' ')).toContain('nought');
  });
});

describe('cells that are not all one row', () => {
  const TEXT = [HEADING, ARMOUR_HALF, '5.1 2C X 16 mm² m 19000', '5.2 3C X 2.5 mm² m 4000'].join(
    '\n',
  );
  const row52: Candidate = {
    ...row51,
    itemRef: '5.2',
    cores: 3,
    sizeMm2: 2.5,
    quantity: 4000,
    evidence: { row: ['5.2 3C X 2.5 mm² m 4000'], heading: [] },
  };

  it('is refused, even though every figure is genuinely printed', () => {
    /*
      The fiction built out of true statements: 16 mm² is printed on row 5.1
      and 4,000 is printed on row 5.2, so a candidate numbered 5.1 that quotes
      both cells has every number it reports printed in the document — and a
      quantity that would go to a customer attached to the wrong cable.
    */
    const crossed: Candidate = {
      ...row51,
      quantity: 4000,
      evidence: { row: ['5.1 2C X 16 mm² m 19000', '5.2 3C X 2.5 mm² m 4000'], heading: [] },
    };
    const out = readCandidates({ candidates: [crossed, row52], text: TEXT }).document;

    expect(out.lines).toEqual(['3C x 2.5 mm² — 4,000 m']);
    expect(out.notes.join(' ')).toContain('quotes a cell belonging to item 5.2');
  });

  it('is refused when a whole intact row is quoted under the wrong number', () => {
    // Nothing split, nothing far apart — two complete rows at the same size,
    // and a candidate numbered 5.1 quoting only 5.2's cell.
    const stolen: Candidate = {
      ...row51,
      sizeMm2: 2.5,
      cores: 3,
      quantity: 4000,
      evidence: { row: ['5.2 3C X 2.5 mm² m 4000'], heading: [] },
    };
    const out = readCandidates({ candidates: [stolen, row52], text: TEXT }).document;

    expect(out.lines).toEqual(['3C x 2.5 mm² — 4,000 m']);
  });

  it('reads both rows when each quotes its own cell', () => {
    const out = readCandidates({ candidates: [row51, row52], text: TEXT }).document;

    expect(out.lines).toEqual([
      '2C x 16 mm² Cu XLPE SWA PVC 1kV — 19,000 m',
      '3C x 2.5 mm² — 4,000 m',
    ]);
  });

  it('still reads a row the PDF split across two lines', () => {
    // A quarter of the rows in the document this was built for: description on
    // one line, item number and quantity on the next. Both cells are the row's.
    const split = ['2C X 4 mm²', '5.3 m 9000'].join('\n');
    const out = readCandidates({
      candidates: [
        {
          ...row51,
          itemRef: '5.3',
          sizeMm2: 4,
          quantity: 9000,
          evidence: { row: ['2C X 4 mm²', '5.3 m 9000'], heading: [] },
        },
      ],
      text: split,
    }).document;

    expect(out.lines).toEqual(['2C x 4 mm² — 9,000 m']);
  });

  it('is refused when the row number is nowhere in its own cells', () => {
    const out = readCandidates({
      candidates: [{ ...row51, evidence: { row: ['2C X 16 mm²', 'm 19000'], heading: [] } }],
      text: ['2C X 16 mm²', 'm 19000'].join('\n'),
    }).document;

    expect(out.lines).toEqual([]);
    expect(out.notes.join(' ')).toContain('none of the cells it quotes carry that row number');
  });
});

describe('a spec term the quoted text does not use', () => {
  it('is dropped without costing the rest of the line', () => {
    // Aluminium armour, on a document that says galvanized steel.
    const out = read([{ ...row51, armour: 'AWA' }]).document;

    expect(out.lines).toEqual(['2C x 16 mm² Cu XLPE PVC 1kV — 19,000 m']);
  });

  it('is dropped when the model quoted only the row, not the heading', () => {
    const out = read([{ ...row51, evidence: { row: ['5.1 2C X 16 mm² m 19000'], heading: [] } }]).document;

    // Nothing on the row itself states any of it, so none of it survives.
    expect(out.lines).toEqual(['2C x 16 mm² — 19,000 m']);
  });

  it('survives wording the dictionary does not hold word for word', () => {
    // "galvanized steel round wire armour" is not a synonym of SWA; "steel
    // wire armour" is, and it is in there with a word in the middle.
    expect(containsPhrase(ARMOUR_HALF, 'steel wire armour')).toBe(true);
    expect(containsPhrase(ARMOUR_HALF, 'aluminium wire armour')).toBe(false);
  });

  it('does not match words scattered across a paragraph', () => {
    const far = 'steel is used in many places on this project, and the cable is armoured';
    expect(containsPhrase(far, 'steel wire armour')).toBe(false);
  });

  it('reads a term through a trailing comma', () => {
    expect(containsPhrase('600/1000V, MULTI-STRANDED COPPER', '600/1000v')).toBe(true);
  });
});

describe('quantities in kilometres', () => {
  const KM = '5.1 2C X 16 mm² km 19000';

  it('are converted only when the text says kilometres', () => {
    const out = readCandidates({
      candidates: [{ ...row51, quantityUnit: 'km', evidence: { row: [KM], heading: [] } }],
      text: KM,
    }).document;

    expect(out.lines[0]).toContain('19,000,000 m');
  });

  it('are read as metres when the claim is not in the text', () => {
    // A thousandfold error is the one mistake worth checking the words for.
    const out = read([{ ...row51, quantityUnit: 'km' }]).document;
    expect(out.lines[0]).toContain('19,000 m');
  });

  it('say so when the claim is refused, because the model might be right', () => {
    const out = read([{ ...row51, quantityUnit: 'km' }]).document;

    // Refusing quietly is only safe if the model was wrong. If the document
    // says `Kms.` and this did not recognise it, the line goes out at a
    // thousandth of the length under a note saying nothing was converted.
    expect(out.notes.join(' ')).toContain('Item 5.1 was read in metres');
    expect(out.notes.join(' ')).toContain('Kilometres were claimed');
  });
});

describe('a row with no core count', () => {
  const EARTH = '7.3 16 mm² Y/G CABLE m 5000';

  it('keeps the size and leaves the cores empty rather than assuming one', () => {
    const out = readCandidates({
      candidates: [
        {
          itemRef: '7.3',
          cores: null,
          sizeMm2: 16,
          quantity: 5000,
          quantityUnit: 'm',
          insulation: null,
          evidence: { row: [EARTH], heading: [] },
        },
      ],
      text: EARTH,
    }).document;

    expect(out.lines).toEqual(['16 mm² — 5,000 m']);
  });
});

describe('statesNumber', () => {
  it('reads a number, not a substring', () => {
    expect(statesNumber('5.1 2C X 16 mm² m 19000', 16)).toBe(true);
    expect(statesNumber('5.1 2C X 16 mm² m 19000', 1)).toBe(false);
    expect(statesNumber('5.1 2C X 16 mm² m 19000', 1900)).toBe(false);
    expect(statesNumber('3C X 2.5 mm² m 4000', 2.5)).toBe(true);
    expect(statesNumber('3C X 2.5 mm² m 4000', 25)).toBe(false);
  });

  it('reads a thousands separator', () => {
    expect(statesNumber('qty 19,000 m', 19000)).toBe(true);
  });
});

describe('the request schema', () => {
  type Field = { anyOf?: { type?: string; enum?: unknown[] }[] };
  const fieldOf = (schema: unknown, name: string): Field =>
    (schema as { properties: { lines: { items: { properties: Record<string, Field> } } } })
      .properties.lines.items.properties[name]!;

  /** The words a field will accept, ignoring the null branch. */
  const choices = (field: Field) => field.anyOf?.find((b) => b.type !== 'null')?.enum;

  it('offers the model only terms the app already knows', () => {
    const armour = choices(fieldOf(schemaFor(BUILT_IN_TERMS), 'armour'));

    expect(armour).toContain('SWA');
    expect(armour).not.toContain('XLPE');
  });

  it('grows with the dictionary, so a taught term can be used the same day', () => {
    const schema = schemaFor([
      ...BUILT_IN_TERMS,
      { canonical: 'DSTA', axis: 'armour', synonyms: ['double steel tape armour'] },
    ]);

    expect(choices(fieldOf(schema, 'armour'))).toContain('DSTA');
  });

  /*
    The shape, not just the contents.

    `{ type: ['string', 'null'], enum: [...] }` is valid JSON Schema, is what
    every offline validator accepts, and is rejected by the API with a 400:
    `Enum value 'm' does not match declared type '['string','null']'`. It cost
    the first live call to find. This test is here so the obvious spelling
    cannot come back.
  */
  it('spells a nullable enum as two branches, which is the only form the API takes', () => {
    for (const name of ['armour', 'voltage', 'quantityUnit']) {
      const field = fieldOf(schemaFor(BUILT_IN_TERMS), name);

      // Both branches named, not just "there are two of them and one is null".
      // Two null branches would satisfy the looser reading and would send a
      // field the model can only ever answer nothing to.
      expect(field.anyOf?.map((b) => b.type).sort()).toEqual(['null', 'string']);
      expect(choices(field)?.length).toBeGreaterThan(0);
      expect(field).not.toHaveProperty('enum');
    }
  });
});
