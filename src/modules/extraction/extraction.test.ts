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
    // `S/N` is a serial column, not an unrecognised one. Naming it is what
    // keeps it from competing with the description column beside it.
    expect(header?.columns).toEqual([
      'serial',
      'description',
      'quantity',
      'unit',
    ]);
  });

  /**
   * The commonest RFQ layout there is, and it used to be read wrong.
   *
   * `item` sat in the description vocabulary, so both of the first two columns
   * classified as description and the column was chosen with `indexOf` — the
   * leftmost won. Every cable description came back as its own row number, and
   * the document reported itself readable with two lines successfully read.
   */
  it('reads the description column, not the item-number column beside it', () => {
    const grid = [
      ['Item', 'Description', 'Qty', 'Unit'],
      ['1', '3C x 50mm2 Cu XLPE SWA PVC 1kV', '12500', 'M'],
      ['2', '4C x 25mm2 Cu XLPE SWA PVC 1kV', '3500', 'M'],
    ];
    const header = findHeaderRow(grid);
    expect(header?.columns).toEqual(['serial', 'description', 'quantity', 'unit']);

    const doc = extractFromGrid(grid);
    expect(doc.unreadable).toBe(false);
    expect(doc.lines).toEqual([
      '3C x 50mm2 Cu XLPE SWA PVC 1kV — 12,500 m',
      '4C x 25mm2 Cu XLPE SWA PVC 1kV — 3,500 m',
    ]);
  });

  it('falls back to the item column when nothing is headed description, and says so', () => {
    // A sheet where `Item` really does hold the cable. Reading it is right;
    // reading it silently is not, because the same header on a different sheet
    // holds a row number.
    const doc = extractFromGrid([
      ['Item', 'Qty', 'Unit'],
      ['3C x 50mm2 Cu XLPE SWA PVC 1kV', '12500', 'M'],
    ]);
    expect(doc.lines).toEqual(['3C x 50mm2 Cu XLPE SWA PVC 1kV — 12,500 m']);
    expect(doc.notes.join(' ')).toMatch(/no column was headed “description”/i);
  });

  it('finds a header past the thirtieth row', () => {
    /*
      The grid is every sheet of the workbook end to end, so a covering letter
      pushes the schedule down. The scan stopped at thirty rows and the file
      came back unreadable — the exact case the reader claims to handle.
    */
    const letter = Array.from({ length: 35 }, (_, i) => [`Covering letter line ${i + 1}`]);
    const grid = [
      ...letter,
      ['S/N', 'Description', 'Qty', 'Unit'],
      ['1', '3C x 50mm2 Cu XLPE SWA PVC 1kV', '12000', 'M'],
    ];
    expect(findHeaderRow(grid)?.index).toBe(35);
    expect(extractFromGrid(grid).unreadable).toBe(false);
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

/**
 * Provenance.
 *
 * Phase 3's promise is that an engineer never opens the attachment to check a
 * number. That only holds if the app kept the answer at the moment it read the
 * file — a line reads `3Cx50 mm2 XLPE — 12,500 m` afterwards, and nothing in
 * that string says which row of which sheet it was assembled from.
 */
describe('where each line came from', () => {
  const GRID = [
    ['MUSCAT ELECTRICALS LLC'],
    ['Description', 'Qty', 'Unit'],
    ['3C x 50mm2 Cu XLPE SWA PVC 1kV', '12000', 'M'],
    ['Total', '', ''],
    ['4C x 16mm2 Cu XLPE SWA PVC 1kV', '8.5', 'KM'],
  ];

  it('points at the row a spreadsheet line was read from', () => {
    const doc = extractFromGrid(GRID);

    expect(doc.lines).toHaveLength(2);
    expect(doc.sources).toHaveLength(2);
    // Row index 2 and row index 4 — the "Total" row between them was skipped,
    // so the second line's source is 4 and not 3.
    expect(doc.sources.map((s) => s.line)).toEqual([2, 4]);
    expect(doc.sources[0]?.where).toBe('row 3');
  });

  it('names the sheet, because row 704 of a workbook is unfindable', () => {
    const doc = extractFromGrid(GRID, [
      { name: 'Covering letter', from: 0, to: 1 },
      { name: 'Schedule of Cables', from: 1, to: 5 },
    ]);

    expect(doc.sources[0]?.where).toBe('Schedule of Cables, row 2');
    expect(doc.sources[1]?.where).toBe('Schedule of Cables, row 4');
    // The note that says where the table started uses the same words.
    expect(doc.notes[0]).toContain('Schedule of Cables, row 1');
  });

  it('a source points at the line of rawText the view will scroll to', () => {
    const doc = extractFromGrid(GRID);
    const rows = doc.rawText.split('\n');

    for (const [i, source] of doc.sources.entries()) {
      // The row it points at is the row the line was actually built from.
      expect(rows[source.line]).toContain(doc.lines[i]!.split(' — ')[0]);
    }
  });

  it('names the page a PDF line was read from, skipping the blank lines', () => {
    const doc = extractFromText(
      [
        'MUSCAT ELECTRICALS LLC',
        '',
        '1  3C x 50mm2 Cu XLPE SWA PVC 1kV    12,000 m',
        'Page 1 of 2',
        '',
        '2  4C x 16mm2 Cu XLPE SWA PVC 1kV     8,500 m',
      ].join('\n'),
      [
        { name: 'page 1', from: 0, to: 4 },
        { name: 'page 2', from: 4, to: 6 },
      ],
    );

    expect(doc.lines).toHaveLength(2);
    expect(doc.sources.map((s) => s.where)).toEqual(['page 1, line 3', 'page 2, line 2']);

    // And the index is into rawText, which has had the blanks removed — so it
    // is 3, not the 5 it sat at in the file.
    const rows = doc.rawText.split('\n');
    expect(doc.sources[1]?.line).toBe(3);
    expect(rows[doc.sources[1]!.line]).toContain('4C x 16mm2');
  });

  it('offers no sources when it could not read the document', () => {
    expect(extractFromText('   \n  \n').sources).toEqual([]);
    expect(extractFromGrid([['Dear sir'], ['Please quote']]).sources).toEqual([]);
  });
});
