import * as XLSX from 'xlsx';
import { PRECISION } from '@/core/format';
import {
  copperMassIsPartial,
  copperMassOf,
  totalOf,
  type Quote,
} from '@/modules/quoting';

/**
 * The quote, as a workbook.
 *
 * Two sheets, because the two audiences are different. **Quotation** is what
 * goes to the customer: line items, rates, totals, terms. **Cost build-up** is
 * the internal side — every material, every machine stage, every overhead, for
 * every line, with the rate row each figure came from.
 *
 * Numbers are written as *numbers*, not strings, so the recipient can sum a
 * column. That is the one place this file deliberately parts company with the
 * rest of the codebase, which keeps money in Decimal and never in a float:
 * a spreadsheet cell is a float whatever we do, so the conversion happens here,
 * once, at the boundary, with the display precision applied first.
 */

/** Decimal → number, rounded to the precision that figure is displayed at. */
const cell = (value: { toFixed(dp: number): string }, dp: number): number =>
  Number(value.toFixed(dp));

/**
 * A row of a sheet. Dates go in as `Date`, not as ISO strings: a recipient who
 * gets an ISO string cannot sort by it, filter on it, or subtract two of them,
 * and "valid until" is the field they are most likely to want to do all three
 * with. `cellDates` on both the sheet and the write is what keeps them dates.
 */
type Row = (string | number | Date | null)[];

export function renderQuoteXlsx(quote: Quote): Uint8Array {
  const book = XLSX.utils.book_new();

  // ── Quotation ─────────────────────────────────────────────────────────
  const quotation: Row[] = [
    ['QUOTATION', null, null, null, quote.number],
    [],
    ['Customer', quote.customer],
    ['Priced', quote.pricedAt],
    ['Valid until', quote.validUntil],
    ['Margin %', cell(quote.marginPercent, PRECISION.percent)],
    [],
    ['#', 'Description', 'Product', 'Quantity (m)', 'Unit rate (OMR/m)', 'Amount (OMR)'],
  ];

  for (const line of quote.lines) {
    quotation.push([
      line.position + 1,
      line.designation,
      line.productCode,
      cell(line.quantityMetres, 0),
      cell(line.unitRate, PRECISION.quotedRate),
      cell(line.lineTotal, PRECISION.total),
    ]);
  }

  quotation.push(
    [],
    [null, null, null, null, 'Total', cell(totalOf(quote.lines), PRECISION.total)],
    [],
    // The strike travels with the file, so a workbook forwarded to someone
    // else still says what copper it was built on.
    ['Struck on LME (USD/t)', cell(quote.lmeStruck, PRECISION.lme)],
    ['FX (OMR/USD)', cell(quote.fxStruck, PRECISION.fx)],
    [
      copperMassIsPartial(quote.lines)
        ? 'Copper content (kg, at least — excludes lines priced to order)'
        : 'Copper content (kg)',
      cell(copperMassOf(quote.lines), 1),
    ],
    [],
    // The same note the PDF carries: the amount is the offer, and it is built
    // on the unrounded rate.
    ['Amounts are calculated on the unrounded unit rate; the rate shown is rounded to 4 places.'],
  );

  if (quote.terms !== null && quote.terms !== '') {
    quotation.push([], ['Terms', quote.terms]);
  }

  const q = XLSX.utils.aoa_to_sheet(quotation, { cellDates: true });
  q['!cols'] = [{ wch: 4 }, { wch: 62 }, { wch: 20 }, { wch: 14 }, { wch: 18 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(book, q, 'Quotation');

  // ── Cost build-up ─────────────────────────────────────────────────────
  //
  // The auditable half. One row per component of every line, so an engineer
  // can trace any figure on the quotation back to the kilogram it came from
  // without opening the app.
  const buildup: Row[] = [
    [
      'Line', 'Product', 'Section', 'Item', 'Quantity', 'Unit',
      'Rate', 'Cost (OMR/km)', 'Rate row', 'Effective from',
    ],
  ];

  for (const line of quote.lines) {
    const n = line.position + 1;
    const b = line.breakdown;

    // A hand-priced line has no build-up, so it gets the one row that is true
    // of it: the rate, who set it, and why. Padding it out with zeros would
    // make the auditable sheet the least honest thing in the workbook.
    if (b === null) {
      buildup.push(
        [
          n, line.productCode || '—', 'Hand-priced', line.decision?.reason ?? '',
          null, null, cell(line.unitRate, PRECISION.quotedRate), null,
          line.decision?.by ?? '', line.decision?.at ?? null,
        ],
        [],
      );
      continue;
    }

    /*
      The line was costed, and then a person replaced the rate.

      Without this row the workbook argues with itself: the Quotation sheet
      carries the human's rate while every row below carries the engine's, and
      the two sum to different numbers with nothing to say why. The reason, the
      author and the date were recorded at approval and written nowhere — on
      the one sheet whose entire purpose is showing where a number came from.

      Stated first, before the build-up it overrides, so the rows underneath
      are read as what the line *would* have cost rather than as what is being
      charged.
    */
    if (line.decision?.unitRate != null) {
      buildup.push([
        n, line.productCode, 'Priced by hand', line.decision.reason,
        null, null, cell(line.decision.unitRate, PRECISION.quotedRate), null,
        line.decision.by, line.decision.at,
      ]);
      buildup.push([
        n, line.productCode, 'Build-up below is the engine’s own cost for this ' +
          'product, kept for comparison. It is not what is being charged.',
      ]);
    }

    for (const m of b.materials) {
      buildup.push([
        n, line.productCode, 'Material', m.materialName,
        cell(m.effectiveConsumption, PRECISION.weight), 'kg/km',
        cell(m.rate, PRECISION.unitRate), cell(m.cost, PRECISION.costPerKm),
        m.source.rateId, m.source.effectiveFrom,
      ]);
    }

    for (const o of b.operations) {
      buildup.push([
        n, line.productCode, 'Operation', o.machineName,
        cell(o.hours, PRECISION.hours), 'hours',
        cell(o.rate, PRECISION.unitRate), cell(o.cost, PRECISION.costPerKm),
        o.source.rateId, o.source.effectiveFrom,
      ]);
    }

    for (const o of b.overheads) {
      buildup.push([
        n, line.productCode, 'Overhead', o.name,
        null, null, null, cell(o.cost, PRECISION.costPerKm),
        o.source.rateId, o.source.effectiveFrom,
      ]);
    }

    buildup.push(
      [n, line.productCode, 'Tooling', 'Tooling', null, null, null,
        cell(b.tooling, PRECISION.costPerKm), null, null],
      [n, line.productCode, 'Total', 'Cost per km', null, null, null,
        cell(b.costPerKm, PRECISION.costPerKm), null, null],
      [n, line.productCode, 'Total', 'Cost per metre', null, null, null,
        cell(b.costPerMetre, PRECISION.costPerMetre), null, null],
      [n, line.productCode, 'Commercial',
        `Margin ${b.commercial.marginPercent.toFixed(1)}%`, null, null, null,
        cell(b.commercial.marginAmount, PRECISION.costPerKm), null, null],
      [n, line.productCode, 'Total', 'Unit rate (OMR/m)', null, null, null,
        cell(b.unitRate, PRECISION.unitRate), null, null],
      [],
    );
  }

  const c = XLSX.utils.aoa_to_sheet(buildup, { cellDates: true });
  c['!cols'] = [
    { wch: 5 }, { wch: 20 }, { wch: 12 }, { wch: 38 }, { wch: 12 },
    { wch: 8 }, { wch: 12 }, { wch: 14 }, { wch: 16 }, { wch: 14 },
  ];
  XLSX.utils.book_append_sheet(book, c, 'Cost build-up');

  return XLSX.write(book, {
    type: 'buffer',
    bookType: 'xlsx',
    cellDates: true,
  }) as Uint8Array;
}
