import { Prisma, type PrismaClient } from '@prisma/client';
import { dec } from '@/core/decimal';
import { omr, usdPerTonne } from '@/core/units';
import type { Actor } from '@/modules/auth';
import type { CostBreakdown } from '@/modules/costing';
import type { OpenQuote } from '@/modules/pricewatch';
import type {
  AssembledQuote,
  Quote,
  QuoteLine,
  QuoteStatus,
} from '@/modules/quoting';
import { nextQuoteNumber } from '@/modules/quoting';
import type { QuoteRepository } from '@/modules/rates';
import { prisma as defaultClient } from './client';

/**
 * Quote persistence.
 *
 * The frozen `CostBreakdown` goes in as JSONB. It contains Decimals and Dates,
 * neither of which survives `JSON.stringify` as itself — Decimals become
 * strings, Dates become ISO strings — so hydration walks it back explicitly
 * rather than trusting the round trip. That walk is the reason a quote can
 * still be opened and explained eight months later.
 */

interface QuoteRow {
  readonly id: string;
  readonly number: string;
  readonly status: QuoteStatus;
  readonly customer: string;
  readonly terms: string | null;
  readonly priced_at: Date;
  readonly valid_until: Date;
  readonly lme_struck: string;
  readonly fx_struck: string;
  readonly margin_percent: string;
  readonly created_by: string | null;
  readonly created_at: Date;
  readonly approved_at: Date | null;
}

interface LineRow {
  readonly quote_id: string;
  readonly position: number;
  readonly request_text: string;
  readonly product_code: string;
  readonly source_sheet: string;
  readonly designation: string;
  readonly quantity_metres: string;
  readonly unit_rate: string;
  readonly line_total: string;
  readonly cost_snapshot: unknown;
  readonly override_rate: string | null;
  readonly decision_reason: string | null;
  readonly decision_by: string | null;
  readonly decision_at: Date | null;
}

interface OpenQuoteRow {
  readonly number: string;
  readonly customer: string;
  readonly lme_struck: string;
  readonly fx_struck: string;
  readonly priced_at: Date;
  readonly valid_until: Date;
  readonly value: string;
  readonly copper_mass_kg: string;
}

/** A parsed JSONB object: keys we know the names of, values we do not trust yet. */
type Json = Record<string, unknown>;

/**
 * Rebuilds a CostBreakdown from JSONB.
 *
 * Every numeric came out of `JSON.stringify` as a string and every Date as an
 * ISO string. Reviving them through `dec()` and `new Date()` is what keeps the
 * frozen snapshot arithmetically identical to the one that was written.
 */
function reviveBreakdown(raw: unknown): CostBreakdown {
  const o = raw as Json;

  /**
   * Every numeric in the snapshot is a string on the way back. `dec()` is the
   * only constructor allowed to turn one into money — the branded unit types
   * are erased by JSON, so the assertions below re-apply what the walk restored.
   */
  const d = (v: unknown) => dec(String(v)) as never;

  /** One array of cost lines: named fields back to Decimal, the source date back to a Date. */
  const revive = (value: unknown, numeric: readonly string[]): unknown[] =>
    (value as Json[]).map((row) => {
      const out: Json = { ...row };
      for (const k of numeric) out[k] = d(row[k]);
      const src = row['source'] as Json | undefined;
      if (src !== undefined) {
        out['source'] = { ...src, effectiveFrom: new Date(String(src['effectiveFrom'])) };
      }
      return out;
    });

  const strike = o['strike'] as Json;
  const commercial = o['commercial'] as Json;

  return {
    ...(o as unknown as CostBreakdown),
    materials: revive(o['materials'], [
      'consumption', 'scrap', 'effectiveConsumption', 'rate', 'cost',
    ]) as CostBreakdown['materials'],
    operations: revive(o['operations'], [
      'hours', 'cores', 'rate', 'cost',
    ]) as CostBreakdown['operations'],
    overheads: revive(o['overheads'], ['cost']) as CostBreakdown['overheads'],
    materialsSubtotal: d(o['materialsSubtotal']),
    operationsSubtotal: d(o['operationsSubtotal']),
    overheadsSubtotal: d(o['overheadsSubtotal']),
    tooling: d(o['tooling']),
    costPerKm: d(o['costPerKm']),
    costPerMetre: d(o['costPerMetre']),
    unitRate: d(o['unitRate']),
    quantity: d(o['quantity']),
    lineTotal: d(o['lineTotal']),
    copperMassPerKm: d(o['copperMassPerKm']),
    commercial: {
      ...(commercial as unknown as CostBreakdown['commercial']),
      marginPercent: d(commercial['marginPercent']),
      marginAmount: d(commercial['marginAmount']),
      drumCost: d(commercial['drumCost']),
      packingCost: d(commercial['packingCost']),
      freightCost: d(commercial['freightCost']),
    },
    strike: {
      lme: d(strike['lme']),
      fx: d(strike['fx']),
      copperOmrPerKg: d(strike['copperOmrPerKg']),
      asOf: new Date(String(strike['asOf'])),
    },
  };
}

function hydrate(q: QuoteRow, lines: readonly LineRow[]): Quote {
  return {
    id: q.id,
    number: q.number,
    status: q.status,
    customer: q.customer,
    terms: q.terms,
    pricedAt: q.priced_at,
    validUntil: q.valid_until,
    lmeStruck: dec(q.lme_struck),
    fxStruck: dec(q.fx_struck),
    marginPercent: dec(q.margin_percent),
    createdBy: q.created_by,
    createdAt: q.created_at,
    approvedAt: q.approved_at,
    lines: lines
      .filter((l) => l.quote_id === q.id)
      .sort((a, b) => a.position - b.position)
      .map(
        (l): QuoteLine => ({
          position: l.position,
          requestText: l.request_text,
          productCode: l.product_code,
          sourceSheet: l.source_sheet,
          designation: l.designation,
          quantityMetres: dec(l.quantity_metres),
          unitRate: dec(l.unit_rate),
          lineTotal: omr(l.line_total),
          // A null snapshot is not a missing one — it is a line an engineer
          // priced by hand, and the override beside it is the explanation.
          breakdown:
            l.cost_snapshot === null ? null : reviveBreakdown(l.cost_snapshot),
          // A decision with no rate is a product an engineer chose; a decision
          // with one is a price they set. Both are people, not the app.
          decision:
            l.decision_at === null
              ? null
              : {
                  unitRate: l.override_rate === null ? null : dec(l.override_rate),
                  reason: l.decision_reason ?? '',
                  by: l.decision_by ?? '',
                  at: l.decision_at,
                },
        }),
      ),
  };
}

const SELECT_QUOTE = `
  SELECT q.id::text, q.number, q.status::text AS status, q.customer, q.terms,
         q.priced_at, q.valid_until, q.lme_struck::text AS lme_struck,
         q.fx_struck::text AS fx_struck, q.margin_percent::text AS margin_percent,
         u.name AS created_by, q.created_at, q.approved_at
    FROM quote q LEFT JOIN app_user u ON u.id = q.created_by_id`;

const SELECT_LINES = `
  SELECT quote_id::text, position, request_text, product_code, source_sheet,
         designation, quantity_metres::text AS quantity_metres,
         unit_rate::text AS unit_rate, line_total::text AS line_total,
         cost_snapshot, override_rate::text AS override_rate,
         decision_reason, decision_by, decision_at
    FROM quote_line`;

export class DbQuoteRepository implements QuoteRepository {
  constructor(private readonly db: PrismaClient = defaultClient) {}

  /**
   * The price watch's feed: quotes still standing, with their copper exposure.
   *
   * Copper mass is summed in SQL out of the frozen snapshot rather than by
   * hydrating every breakdown in Node — the watch runs over the whole open
   * book on every page load, and it only needs one number per quote.
   *
   * Lapsed quotes are included deliberately. A quote that expired yesterday is
   * exactly the one a customer rings about, and the watch labels it `lapsed`
   * rather than hiding it.
   */
  async open(): Promise<readonly OpenQuote[]> {
    const rows = await this.db.$queryRaw<OpenQuoteRow[]>`
      SELECT q.number,
             q.customer,
             q.lme_struck::text AS lme_struck,
             q.fx_struck::text  AS fx_struck,
             q.priced_at,
             q.valid_until,
             coalesce(sum(l.line_total), 0)::text AS value,
             coalesce(sum(
               (l.cost_snapshot->>'copperMassPerKm')::numeric
                 * l.quantity_metres / 1000
             ), 0)::text AS copper_mass_kg
        FROM quote q LEFT JOIN quote_line l ON l.quote_id = q.id
       WHERE q.status IN ('approved', 'sent')
       GROUP BY q.id
       ORDER BY q.priced_at DESC`;

    return rows.map((r) => ({
      number: r.number,
      customer: r.customer,
      struckLme: usdPerTonne(r.lme_struck),
      struckAt: r.priced_at,
      expiresAt: r.valid_until,
      value: omr(r.value),
      copperMassKg: dec(r.copper_mass_kg),
      fx: dec(r.fx_struck),
    }));
  }

  async list(limit = 100): Promise<readonly Quote[]> {
    const quotes = await this.db.$queryRawUnsafe<QuoteRow[]>(
      `${SELECT_QUOTE} ORDER BY q.created_at DESC LIMIT ${Number(limit)}`,
    );
    if (quotes.length === 0) return [];

    // One query for every line rather than one per quote.
    const lines = await this.db.$queryRawUnsafe<LineRow[]>(
      `${SELECT_LINES} WHERE quote_id = ANY($1::uuid[])`,
      quotes.map((q) => q.id),
    );
    return quotes.map((q) => hydrate(q, lines));
  }

  async byNumber(number: string): Promise<Quote | undefined> {
    const quotes = await this.db.$queryRawUnsafe<QuoteRow[]>(
      `${SELECT_QUOTE} WHERE q.number = $1`,
      number,
    );
    const quote = quotes[0];
    if (quote === undefined) return undefined;

    const lines = await this.db.$queryRawUnsafe<LineRow[]>(
      `${SELECT_LINES} WHERE quote_id = $1::uuid`,
      quote.id,
    );
    return hydrate(quote, lines);
  }

  /**
   * Writes an assembled quote and its lines in one transaction, approved.
   *
   * The number is derived inside the transaction from the count so far this
   * year, so two engineers approving at once cannot both take Q-2026-0148 —
   * the unique index on `number` refuses the second, and the whole
   * transaction is abandoned rather than half-written.
   */
  async approve(
    assembled: AssembledQuote,
    actor: Actor,
  ): Promise<{ readonly number: string; readonly id: string }> {
    return this.db.$transaction(async (tx) => {
      const year = assembled.pricedAt.getUTCFullYear();
      const counted = await tx.$queryRaw<{ count: bigint }[]>`
        SELECT count(*) FROM quote WHERE number LIKE ${`Q-${year}-%`}`;

      const number = nextQuoteNumber(year, Number(counted[0]?.count ?? 0));

      const created = await tx.quote.create({
        data: {
          number,
          status: 'approved',
          customer: assembled.customer,
          terms: assembled.terms,
          pricedAt: assembled.pricedAt,
          validUntil: assembled.validUntil,
          lmeStruck: assembled.lmeStruck.toString(),
          fxStruck: assembled.fxStruck.toString(),
          marginPercent: assembled.marginPercent.toString(),
          createdById: actor.id,
          approvedAt: new Date(),
        },
      });

      await tx.quoteLine.createMany({
        data: assembled.lines.map((l, position) => ({
          quoteId: created.id,
          position,
          requestText: l.requestText,
          productCode: l.productCode,
          sourceSheet: l.sourceSheet,
          designation: l.designation,
          quantityMetres: l.quantityMetres.toString(),
          unitRate: l.unitRate.toString(),
          lineTotal: l.lineTotal.toString(),
          // `Prisma.DbNull`, not `null`: for a nullable Json column Prisma
          // distinguishes "SQL NULL" from "the JSON value null", and plain
          // null is not accepted for either.
          costSnapshot:
            l.breakdown === null
              ? Prisma.DbNull
              : (JSON.parse(JSON.stringify(l.breakdown)) as Prisma.InputJsonValue),
          overrideRate: l.decision?.unitRate?.toString() ?? null,
          decisionReason: l.decision?.reason ?? null,
          decisionBy: l.decision?.by ?? null,
          decisionAt: l.decision?.at ?? null,
        })),
      });

      const decided = assembled.lines.filter((l) => l.decision !== null).length;

      await tx.auditEvent.create({
        data: {
          actorId: actor.id,
          actorEmail: actor.email,
          entity: `quote:${number}`,
          field: 'status',
          previous: 'draft',
          next: 'approved',
          // The strike goes in the reason, so the audit trail alone answers
          // "what copper was this approved on" without opening the quote.
          reason:
            `${assembled.lines.length} lines, ${assembled.total.toFixed(2)} OMR, ` +
            `struck on ${assembled.lmeStruck.toString()} USD/t` +
            (decided === 0 ? '' : `, ${decided} settled by hand`),
        },
      });

      return { number, id: created.id };
    });
  }
}
