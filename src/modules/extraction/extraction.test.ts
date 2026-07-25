import { describe, expect, it } from 'vitest';
import {
  classifyHeader,
  extractFromGrid,
  extractFromText,
  findHeaderRow,
  looksLikeCableLine,
  readQuantity,
} from './index';

/**
 * The contract for reading a customer's document.
 *
 * Two rules are on trial throughout: extraction ends in the same text shape
 * paste produces, and anything it cannot read confidently is handed back
 * rather than guessed at. The tests that matter most are the refusals.
 */

describe('classifyHeader', () => {
  it('recognises the headings RFQ spreadsheets actually use', () => {
    expect(classifyHeader('Description')).toBe('description');
    expect(classifyHeader('  MATERIAL DESCRIPTION ')).toBe('description');
    expect(classifyHeader('Qty.')).toBe('quantity');
    expect(classifyHeader('Quantity Required')).toBe('quantity');
    expect(classifyHeader('UOM')).toBe('unit');
  });

  it('ignores a heading it does not know, rather than guessing at it', () => {
    // A mis-recognised heading silently quotes the wrong quantity; an ignored
    // one is visible and fixable.
    expect(classifyHeader('Delivery week')).toBe('ignore');
    expect(classifyHeader('')).toBe('ignore');
  });
});

describe('readQuantity', () => {
  it('reads the forms a spreadsheet holds', () => {
    expect(readQuantity('1250')).toBe('1250');
    expect(readQuantity(' 12,000 ')).toBe('12000');
    expect(readQuantity('2.5')).toBe('2.5');
  });

  it('refuses anything that is not plainly a number', () => {
    expect(readQuantity('approx 500')).toBeNull();
    expect(readQuantity('TBC')).toBeNull();
    expect(readQuantity('')).toBeNull();
    expect(readQuantity('0')).toBeNull();
    expect(readQuantity('-100')).toBeNull();
  });
});

describe('findHeaderRow', () => {
  it('finds a table under a letterhead', () => {
    const grid = [
      ['MUSCAT ELECTRICALS LLC'],
      ['PO Box 1234, Muscat'],
      [],
      ['Enquiry ref', 'ME/2026/0088'],
      [],
      ['S/N', 'Description', 'Qty', 'Unit'],
      ['1', '3C x 50mm2 Cu XLPE SWA PVC 1kV', '12000', 'M'],
    ];
    const header = findHeaderRow(grid);
    expect(header?.index).toBe(5);
    expect(header?.columns).toEqual([
      'ignore',
      'description',
      'quantity',
      'unit',
    ]);
  });

  it('refuses a table with a description but no quantity', () => {
    // Every line would fall back to a default length, and a quote built on
    // defaulted quantities is worse than no quote at all.
    expect(findHeaderRow([['Description', 'Delivery week']])).toBeNull();
  });

  it('refuses a sheet with no recognisable table', () => {
    expect(findHeaderRow([['some'], ['prose'], ['about cables']])).toBeNull();
  });
});

describe('extractFromGrid', () => {
  const grid = [
    ['MUSCAT ELECTRICALS LLC'],
    [],
    ['S/N', 'Description', 'Qty', 'Unit'],
    ['1', '3C x 50mm2 Cu XLPE SWA PVC 1kV', '12,000', 'M'],
    ['2', '4C x 16mm2 Cu XLPE SWA PVC 1kV', '2.5', 'KM'],
    ['3', '10 Pair x 1.5mm2 Cu XLPE IOSCR PVC SWA 500V', 'TBC', 'M'],
    ['', '', '', ''],
    ['', 'Total', '14500', ''],
  ];

  it('produces lines in exactly the shape paste produces', () => {
    const doc = extractFromGrid(grid);
    // The quantity is appended as text the line parser already reads. One
    // parser, one set of rules about what a quantity is.
    expect(doc.lines).toEqual([
      '3C x 50mm2 Cu XLPE SWA PVC 1kV — 12,000 m',
      '4C x 16mm2 Cu XLPE SWA PVC 1kV — 2,500 m',
    ]);
  });

  it('converts kilometres to metres from the unit column', () => {
    expect(extractFromGrid(grid).lines[1]).toContain('2,500 m');
  });

  it('skips a row whose quantity cannot be read, and says which', () => {
    const doc = extractFromGrid(grid);
    expect(doc.lines).toHaveLength(2);
    expect(doc.notes.join(' ')).toContain('1 row skipped');
    expect(doc.notes.join(' ')).toContain('TBC');
    // The dropped line is named, not silently absent.
    expect(doc.notes.join(' ')).toContain('10 Pair');
  });

  it('leaves out a totals row rather than quoting it as a cable', () => {
    expect(extractFromGrid(grid).lines.join(' ')).not.toContain('Total');
  });

  it('hands back the whole file when it finds no table', () => {
    const doc = extractFromGrid([['just'], ['some prose']]);
    expect(doc.unreadable).toBe(true);
    expect(doc.lines).toHaveLength(0);
    expect(doc.rawText).toContain('some prose');
    expect(doc.notes[0]).toContain('paste the cable lines in by hand');
  });
});

describe('looksLikeCableLine', () => {
  it('accepts a line carrying both a cable and a quantity', () => {
    expect(looksLikeCableLine('3C x 50mm2 Cu XLPE SWA PVC 1kV — 12,000 m')).toBe(true);
    expect(looksLikeCableLine('10 Pair x 1.5mm2 Cu XLPE 500V 2,000 metres')).toBe(true);
  });

  it('rejects prose, headers and half-lines', () => {
    // A page containing the word "cable" is not an RFQ line, and reading it as
    // one would put a line in front of an engineer that never existed.
    expect(looksLikeCableLine('Please quote for the following cables')).toBe(false);
    expect(looksLikeCableLine('3C x 50mm2 Cu XLPE SWA PVC 1kV')).toBe(false);
    expect(looksLikeCableLine('Page 2 of 3')).toBe(false);
    expect(looksLikeCableLine('Delivery: 12,000 m of site cable')).toBe(false);
  });
});

describe('extractFromText', () => {
  it('keeps the cable lines and drops the furniture', () => {
    const doc = extractFromText(
      [
        'MUSCAT ELECTRICALS LLC',
        'Request for quotation ME/2026/0088',
        '',
        '1  3C x 50mm2 Cu XLPE SWA PVC 1kV    12,000 m',
        '2  4C x 16mm2 Cu XLPE SWA PVC 1kV     8,500 m',
        'Terms: 60 days from invoice',
        'Page 1 of 2',
      ].join('\n'),
    );

    expect(doc.lines).toHaveLength(2);
    expect(doc.unreadable).toBe(false);
    expect(doc.notes[0]).toContain('Read 2 cable lines');
    // And it says to check, because a filter is not a reading.
    expect(doc.notes.join(' ')).toContain('Check the extracted text');
  });

  it('says plainly when a PDF is a scan', () => {
    const doc = extractFromText('   \n  \n');
    expect(doc.unreadable).toBe(true);
    expect(doc.notes[0]).toContain('most likely a scan');
    // And why the app will not try: a misread digit is a wrong price.
    expect(doc.notes[0]).toContain('wrong price');
  });

  it('hands back the text when it read words but no cables', () => {
    const doc = extractFromText('Dear sir\nPlease find attached our enquiry.\n');
    expect(doc.unreadable).toBe(true);
    expect(doc.rawText).toContain('Please find attached');
    expect(doc.notes[0]).toContain('no line carried both');
  });
});
