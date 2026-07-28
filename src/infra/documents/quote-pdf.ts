import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { format, formatDate, formatInstant, formatNumber } from '@/core/format';
import {
  copperMassIsPartial,
  copperMassOf,
  overriddenCount,
  totalOf,
  uncostedCount,
  type Quote,
} from '@/modules/quoting';

/**
 * The quote, as a PDF.
 *
 * Laid out by hand with pdf-lib rather than rendered from HTML: no headless
 * browser to run on a serverless function, no layout engine to disagree with
 * itself between environments, and — the reason that matters here — exact
 * control over numeric alignment.
 *
 * Numbers are set in Courier and right-aligned so they line up down the column
 * the way they do on screen. DESIGN_SYSTEM.md §1 rule 4 calls that out as the
 * single decision separating a costing instrument from a website; it applies
 * to the paper a customer actually receives at least as much as to the screen.
 *
 * The document is deliberately monochrome. It gets printed, faxed, and
 * photocopied.
 */

const A4 = { width: 595.28, height: 841.89 };
const MARGIN = 48;
const INK = rgb(0.05, 0.06, 0.08);
const MUTED = rgb(0.42, 0.45, 0.49);
const RULE = rgb(0.78, 0.80, 0.82);

interface Fonts {
  readonly body: PDFFont;
  readonly bold: PDFFont;
  readonly mono: PDFFont;
  readonly monoBold: PDFFont;
}

/**
 * Columns. Every numeric `x` is the column's **right** edge, because the
 * numbers are right-aligned to it — which is the trap this layout fell into
 * once: a right-aligned column grows leftwards, so the description's boundary
 * is not the quantity column's `x` but the far side of the quantity column.
 * `WIDTH` states each one, and the description takes what is left.
 */
const WIDTH = { quantity: 62, rate: 64, total: 72 } as const;
const GUTTER = 10;

const COL = {
  item: MARGIN,
  description: MARGIN + 26,
  total: A4.width - MARGIN,
  rate: A4.width - MARGIN - WIDTH.total - GUTTER,
  quantity: A4.width - MARGIN - WIDTH.total - WIDTH.rate - 2 * GUTTER,
} as const;

/** Where a wrapped description has to stop. */
const DESCRIPTION_WIDTH =
  COL.quantity - WIDTH.quantity - GUTTER - COL.description;

function right(page: PDFPage, text: string, x: number, y: number, font: PDFFont, size: number, color = INK) {
  page.drawText(text, { x: x - font.widthOfTextAtSize(text, size), y, size, font, color });
}

function rule(page: PDFPage, y: number, thickness = 0.5, color = RULE) {
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: A4.width - MARGIN, y },
    thickness,
    color,
  });
}

/** Wraps to the available width, so a long designation never runs off the page. */
function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line === '' ? word : `${line} ${word}`;
    if (font.widthOfTextAtSize(candidate, size) > maxWidth && line !== '') {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line !== '') lines.push(line);
  return lines;
}

export async function renderQuotePdf(quote: Quote): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${quote.number} — ${quote.customer}`);
  pdf.setSubject('Cable quotation');
  pdf.setCreationDate(quote.createdAt);

  const fonts: Fonts = {
    body: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
    mono: await pdf.embedFont(StandardFonts.Courier),
    monoBold: await pdf.embedFont(StandardFonts.CourierBold),
  };

  let page = pdf.addPage([A4.width, A4.height]);
  let y = A4.height - MARGIN;

  const newPage = () => {
    page = pdf.addPage([A4.width, A4.height]);
    y = A4.height - MARGIN;
    header(page, fonts, quote, true);
    y -= 54;
    columnHeadings(page, fonts, y);
    y -= 14;
  };

  // ── Header ────────────────────────────────────────────────────────────
  header(page, fonts, quote, false);
  y -= 74;

  page.drawText(quote.customer, { x: MARGIN, y, size: 12, font: fonts.bold, color: INK });
  right(page, quote.number, A4.width - MARGIN, y, fonts.monoBold, 12);
  y -= 16;

  const meta = [
    ['Priced', formatInstant(quote.pricedAt)],
    ['Valid until', formatDate(quote.validUntil)],
    ['Margin', `${quote.marginPercent.toFixed(1)}%`],
  ] as const;
  for (const [label, value] of meta) {
    page.drawText(label, { x: MARGIN, y, size: 8, font: fonts.body, color: MUTED });
    page.drawText(value, { x: MARGIN + 62, y, size: 8, font: fonts.mono, color: INK });
    y -= 11;
  }

  y -= 12;
  rule(page, y, 1, INK);
  y -= 14;

  columnHeadings(page, fonts, y);
  y -= 14;

  // ── Lines ─────────────────────────────────────────────────────────────
  for (const line of quote.lines) {
    const wrapped = wrap(line.designation, fonts.body, 8.5, DESCRIPTION_WIDTH);
    const blockHeight = 12 + wrapped.length * 10;

    if (y - blockHeight < MARGIN + 120) newPage();

    rule(page, y + 8);

    right(page, String(line.position + 1), COL.description - 8, y - 2, fonts.mono, 8, MUTED);

    wrapped.forEach((text, i) => {
      page.drawText(text, {
        x: COL.description,
        y: y - 2 - i * 10,
        size: 8.5,
        font: fonts.body,
        color: INK,
      });
    });

    // A hand-priced line names itself as one on the document. The customer
    // does not need the reason, but "priced to order" is honest where a
    // product code would be a claim about a catalogue item that was never
    // costed for this line.
    page.drawText(
      line.breakdown === null ? 'Priced to order' : line.productCode,
      {
        x: COL.description,
        y: y - 2 - wrapped.length * 10,
        size: 7,
        font: fonts.mono,
        color: MUTED,
      },
    );

    right(page, `${formatNumber(line.quantityMetres, 0)} m`, COL.quantity, y - 2, fonts.mono, 8.5);
    right(page, format(line.unitRate, 'quotedRate'), COL.rate, y - 2, fonts.mono, 8.5);
    right(page, format(line.lineTotal, 'total'), COL.total, y - 2, fonts.monoBold, 8.5);

    y -= blockHeight + 4;
  }

  // ── Total ─────────────────────────────────────────────────────────────
  if (y < MARGIN + 130) newPage();

  y -= 4;
  rule(page, y + 6, 1, INK);
  y -= 10;

  page.drawText('Total', { x: COL.rate - 60, y, size: 10, font: fonts.bold, color: INK });
  right(page, `${format(totalOf(quote.lines), 'total')} OMR`, COL.total, y, fonts.monoBold, 11);
  y -= 24;

  // ── Terms and the strike ──────────────────────────────────────────────
  if (quote.terms !== null && quote.terms !== '') {
    for (const text of wrap(quote.terms, fonts.body, 8, A4.width - 2 * MARGIN)) {
      page.drawText(text, { x: MARGIN, y, size: 8, font: fonts.body, color: INK });
      y -= 10;
    }
    y -= 8;
  }

  rule(page, y + 6);
  y -= 6;

  /**
   * The strike, on the document itself.
   *
   * A quote separated from this system still has to answer "what copper was
   * this built on, and when does it lapse?" — which is exactly the question a
   * customer asks eight months later.
   */
  const strike = [
    `Struck on LME ${formatNumber(quote.lmeStruck, 2)} USD/t · FX ${quote.fxStruck.toFixed(4)} OMR/USD`,
    // "at least" when some lines were priced by hand: nobody costed their
    // copper, so the figure is a floor, not a total. Printing it as a total
    // would understate the exposure on the one document that outlives us.
    `Copper content ${copperMassIsPartial(quote.lines) ? 'at least ' : ''}` +
      `${formatNumber(copperMassOf(quote.lines), 1)} kg · this price lapses ${formatDate(quote.validUntil)}`,
    // Said plainly, because the customer will multiply the two columns and
    // find they disagree in the last baisa. The amount is the offer.
    'Amounts are calculated on the unrounded unit rate; the rate shown is rounded to 4 places.',
    'Prices are subject to the copper market. A lapsed quote is re-priced on request.',
  ];

  /*
    Two different statements, and they used to be one.

    `handPricedCount` counts every line a person priced, including ones the
    engine had already costed. `copperMassOf` skips lines with no build-up. So
    an overridden *matched* line was inside the copper figure and disclaimed
    out of it by the same sentence — the document contradicting itself about
    what it had weighed.

    The exclusion sentence now counts the set that is genuinely excluded. The
    override is stated separately, because a customer reading a rate the
    build-up does not derive is owed the fact that a person set it.
  */
  const uncosted = uncostedCount(quote.lines);
  const overridden = overriddenCount(quote.lines);
  const extra: string[] = [];
  if (uncosted > 0) {
    extra.push(
      `${uncosted} line${uncosted === 1 ? '' : 's'} priced to order — copper content above excludes ${uncosted === 1 ? 'it' : 'them'}.`,
    );
  }
  if (overridden > 0) {
    extra.push(
      `${overridden} line${overridden === 1 ? '' : 's'} priced by hand against our own build-up.`,
    );
  }
  strike.splice(2, 0, ...extra);
  for (const text of strike) {
    page.drawText(text, { x: MARGIN, y, size: 7, font: fonts.mono, color: MUTED });
    y -= 9;
  }

  return pdf.save();
}

function header(page: PDFPage, fonts: Fonts, quote: Quote, continued: boolean) {
  const top = A4.height - MARGIN;
  page.drawText('QUOTATION', { x: MARGIN, y: top, size: 16, font: fonts.bold, color: INK });
  if (continued) {
    right(page, `${quote.number} (continued)`, A4.width - MARGIN, top, fonts.mono, 8, MUTED);
  } else {
    right(page, 'Cable Quoting', A4.width - MARGIN, top, fonts.body, 9, MUTED);
  }
  page.drawLine({
    start: { x: MARGIN, y: top - 10 },
    end: { x: A4.width - MARGIN, y: top - 10 },
    thickness: 1.5,
    color: INK,
  });
}

function columnHeadings(page: PDFPage, fonts: Fonts, y: number) {
  const h = (text: string, x: number, alignRight = false) => {
    if (alignRight) right(page, text, x, y, fonts.body, 7, MUTED);
    else page.drawText(text, { x, y, size: 7, font: fonts.body, color: MUTED });
  };
  h('DESCRIPTION', COL.description);
  h('QUANTITY', COL.quantity, true);
  h('UNIT RATE', COL.rate, true);
  h('AMOUNT OMR', COL.total, true);
}
