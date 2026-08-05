import { PDFDocument, StandardFonts } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readDocument } from './read-document';

/**
 * pdf.js, opened against a real PDF.
 *
 * Everything else about extraction is tested on strings, which is right —
 * the rules are the interesting part and they do not need a file. But the two
 * worst production failures this app has had were both *pdf.js refusing to
 * start*: once because `DOMMatrix` was missing, once because the worker module
 * it loads at runtime had not been deployed. Neither was visible to a test
 * that never opened a document.
 *
 * This one does, in two seconds. It cannot catch a file that is missing only
 * on the deployment — that is what `outputFileTracingIncludes` is for — but it
 * fails the moment pdf.js will not import or will not parse, which is the
 * shape both outages took.
 */

const KEY = process.env['GEMINI_API_KEY'];

beforeAll(() => {
  // The pdf.js half must stand on its own, so the model is not consulted here.
  delete process.env['GEMINI_API_KEY'];
});
afterAll(() => {
  if (KEY !== undefined) process.env['GEMINI_API_KEY'] = KEY;
});

async function pdfOf(lines: readonly string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([842, 595]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  let y = 540;
  for (const line of lines) {
    page.drawText(line, { x: 30, y, size: 9, font });
    y -= 20;
  }
  return doc.save();
}

describe('reading a PDF', () => {
  it('gets the text out, in reading order', async () => {
    const read = await readDocument(
      await pdfOf([
        '600/1000V, STRANDED ANNEALED PLAIN COPPER CONDUCTOR, XLPE INSULATION,',
        'GALVANIZED STEEL ROUND WIRE ARMOUR AND OVERALL EXTRUDED PVC OUTER SHEATH',
        '1.1   3C X 95 mm2      m   2800',
      ]),
      'schedule.pdf',
      'application/pdf',
    );

    expect(read.rawText.split('\n')).toEqual([
      '600/1000V, STRANDED ANNEALED PLAIN COPPER CONDUCTOR, XLPE INSULATION,',
      'GALVANIZED STEEL ROUND WIRE ARMOUR AND OVERALL EXTRUDED PVC OUTER SHEATH',
      '1.1 3C X 95 mm2 m 2800',
    ]);
  });

  it('says so rather than throwing when nothing is priceable', async () => {
    // The unit before the figure, which is what the pattern reader cannot see.
    const read = await readDocument(
      await pdfOf(['1.1   3C X 95 mm2      m   2800']),
      'schedule.pdf',
      'application/pdf',
    );

    expect(read.unreadable).toBe(true);
    expect(read.notes.join(' ')).toContain('no line carried both a cable description and a quantity');
    expect(read.rawText).not.toBe('');
  });

  it('reads a flat schedule by pattern, with no model involved', async () => {
    const read = await readDocument(
      await pdfOf(['3C x 50mm2 Cu XLPE SWA PVC 1kV - 12,000 m']),
      'schedule.pdf',
      'application/pdf',
    );

    expect(read.lines).toEqual(['3C x 50mm2 Cu XLPE SWA PVC 1kV - 12,000 m']);
    expect(read.unreadable).toBe(false);
  });
});
