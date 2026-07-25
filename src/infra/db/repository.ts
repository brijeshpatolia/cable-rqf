import type { PrismaClient } from '@prisma/client';
import { dec, type Decimal } from '@/core/decimal';
import {
  hours,
  kgPerKm,
  omrPerHour,
  omrPerKg,
  omrPerKm,
  omrPerUSD,
  usdPerTonne,
} from '@/core/units';
import type {
  MachineRate,
  MaterialRate,
  Product,
  ResolvedRateSet,
} from '@/modules/costing';
import type { EffectiveRow } from '@/modules/rates';
import type {
  LmeTick,
  ProductRepository,
  RateRepository,
} from '@/modules/rates';
import { prisma as defaultClient } from './client';

/**
 * The Postgres adapter.
 *
 * Two rules govern every query here.
 *
 * **Every numeric column is cast with `::text`.** Prisma's `Decimal` is a
 * *different constructor* from the app's — a separate copy of decimal.js at a
 * different precision, so `instanceof` is false and arithmetic would silently
 * run at 20 digits instead of 28. Casting to text and rebuilding through
 * `dec()` means a driver's decimal type never enters the pricing path at all.
 *
 * **Rate resolution is one query per costing run, never one per line.** The
 * performance budget in docs/PROJECT_PLAN.md §2.5 depends on it: a 200-line
 * quote resolves rates once and then runs 200 pure function calls over that
 * immutable snapshot.
 *
 * Raw SQL rather than Prisma's query API is deliberate for the in-force
 * lookup. `tstzrange(valid_from, valid_to, '[)') @> $1` uses the GiST index
 * the EXCLUDE constraint already builds; the equivalent expressed through
 * Prisma (`validFrom <= asOf AND (validTo IS NULL OR validTo > asOf)`) is
 * correct but cannot.
 */

export class RateResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RateResolutionError';
  }
}

interface MaterialRow {
  readonly code: string;
  readonly rate: string;
  readonly lme_linked: boolean;
  readonly drawing_premium: string | null;
  readonly valid_from: Date;
  readonly id: string;
}

interface MachineRow {
  readonly code: string;
  readonly rate: string;
  readonly valid_from: Date;
  readonly id: string;
}

interface LmeRow {
  readonly id: string;
  readonly at: Date;
  readonly lme: string;
  readonly fx: string;
  readonly entered_by: string;
}

export class DbRateRepository implements RateRepository {
  constructor(private readonly db: PrismaClient = defaultClient) {}

  async resolveAt(asOf: Date): Promise<ResolvedRateSet> {
    // Three statements, not three-per-line. Issued together so a costing run
    // pays one round trip regardless of how many lines it prices.
    const [materialRows, machineRows, lmeRows] = await Promise.all([
      this.db.$queryRaw<MaterialRow[]>`
        SELECT id::text, code, rate::text AS rate, lme_linked,
               drawing_premium::text AS drawing_premium, valid_from
          FROM material_rate
         WHERE tstzrange(valid_from, valid_to, '[)') @> ${asOf}::timestamptz`,
      this.db.$queryRaw<MachineRow[]>`
        SELECT id::text, code, rate::text AS rate, valid_from
          FROM machine_rate
         WHERE tstzrange(valid_from, valid_to, '[)') @> ${asOf}::timestamptz`,
      this.db.$queryRaw<LmeRow[]>`
        SELECT id::text, at, lme::text AS lme, fx::text AS fx, entered_by
          FROM lme_price
         WHERE at <= ${asOf}::timestamptz
         ORDER BY at DESC
         LIMIT 1`,
    ]);

    const tick = lmeRows[0];
    if (tick === undefined) {
      // Deliberately an error rather than a fallback to the earliest tick.
      // Pricing on a copper figure from *after* the instant being
      // reconstructed would silently produce a number that never existed.
      throw new RateResolutionError(
        `No copper price is on record at or before ${asOf.toISOString()}. ` +
          'The app cannot price on a rate that did not yet exist.',
      );
    }

    return {
      asOf,
      materials: new Map(
        materialRows.map((r): [string, MaterialRate] => [
          r.code,
          {
            rate: omrPerKg(r.rate),
            lmeLinked: r.lme_linked,
            ...(r.drawing_premium !== null
              ? { drawingPremium: omrPerKg(r.drawing_premium) }
              : {}),
            source: {
              rateId: r.id,
              effectiveFrom: r.valid_from,
              table: 'material_rate',
            },
          },
        ]),
      ),
      machines: new Map(
        machineRows.map((r): [string, MachineRate] => [
          r.code,
          {
            rate: omrPerHour(r.rate),
            source: {
              rateId: r.id,
              effectiveFrom: r.valid_from,
              table: 'machine_rate',
            },
          },
        ]),
      ),
      copper: {
        lme: usdPerTonne(tick.lme),
        fx: omrPerUSD(tick.fx),
        source: {
          rateId: tick.id,
          effectiveFrom: tick.at,
          table: 'lme_price',
        },
      },
    };
  }

  /** Every row including closed periods — the Rate Desk shows history. */
  async materialRows(): Promise<readonly EffectiveRow<Decimal>[]> {
    const rows = await this.db.$queryRaw<
      (MaterialRow & { valid_to: Date | null })[]
    >`SELECT id::text, code, rate::text AS rate, lme_linked,
             drawing_premium::text AS drawing_premium, valid_from, valid_to
        FROM material_rate
       ORDER BY code, valid_from DESC`;

    return rows.map((r) => ({
      key: r.code,
      value: dec(r.rate),
      validFrom: r.valid_from,
      validTo: r.valid_to,
      rateId: r.id,
      table: 'material_rate',
    }));
  }

  async machineRows(): Promise<readonly EffectiveRow<Decimal>[]> {
    const rows = await this.db.$queryRaw<
      (MachineRow & { valid_to: Date | null })[]
    >`SELECT id::text, code, rate::text AS rate, valid_from, valid_to
        FROM machine_rate
       ORDER BY code, valid_from DESC`;

    return rows.map((r) => ({
      key: r.code,
      value: dec(r.rate),
      validFrom: r.valid_from,
      validTo: r.valid_to,
      rateId: r.id,
      table: 'machine_rate',
    }));
  }

  async lmeHistory(limit: number): Promise<readonly LmeTick[]> {
    const rows = await this.db.$queryRaw<LmeRow[]>`
      SELECT id::text, at, lme::text AS lme, fx::text AS fx, entered_by
        FROM lme_price ORDER BY at DESC LIMIT ${limit}`;

    return rows.map((r) => ({
      at: r.at,
      lme: dec(r.lme),
      fx: dec(r.fx),
      enteredBy: r.entered_by,
    }));
  }
}

interface ProductRow {
  readonly id: string;
  readonly code: string;
  readonly source_sheet: string;
  readonly designation: string;
  readonly family: string;
  readonly standard: string;
  readonly cores: number;
  readonly size_mm2: string;
  readonly conductor: string;
  readonly insulation: string;
  readonly screen: string;
  readonly armour: string;
  readonly sheath: string;
  readonly voltage: string;
  readonly tooling_per_km: string;
}

interface BomRow {
  readonly product_id: string;
  readonly material_key: string;
  readonly material_name: string;
  readonly consumption: string;
  readonly scrap: string;
}

interface OpRow {
  readonly product_id: string;
  readonly machine_key: string;
  readonly machine_name: string;
  readonly sequence: number;
  readonly hours_per_km: string;
  readonly cores: string;
}

interface OverheadRow {
  readonly product_id: string;
  readonly key: string;
  readonly name: string;
  readonly amount: string;
}

export class DbProductRepository implements ProductRepository {
  constructor(private readonly db: PrismaClient = defaultClient) {}

  /**
   * Four statements for the whole library, not one per product.
   *
   * The catalogue prices all 99 products on load, each needing its full bill
   * of materials — 1,327 BOM lines, 728 operations, 693 overheads. Fetched
   * per-product that would be 397 round trips.
   */
  async list(): Promise<readonly Product[]> {
    const [products, bom, ops, overheads] = await Promise.all([
      this.db.$queryRaw<ProductRow[]>`
        SELECT id::text, code, source_sheet, designation, family, standard,
               cores, size_mm2::text AS size_mm2, conductor, insulation,
               screen, armour, sheath, voltage,
               tooling_per_km::text AS tooling_per_km
          FROM product ORDER BY code, source_sheet`,
      this.db.$queryRaw<BomRow[]>`
        SELECT product_id::text, material_key, material_name,
               consumption::text AS consumption, scrap::text AS scrap
          FROM bom_line ORDER BY product_id, position`,
      this.db.$queryRaw<OpRow[]>`
        SELECT product_id::text, machine_key, machine_name, sequence,
               hours_per_km::text AS hours_per_km, cores::text AS cores
          FROM machine_op ORDER BY product_id, sequence`,
      this.db.$queryRaw<OverheadRow[]>`
        SELECT product_id::text, key, name, amount::text AS amount
          FROM overhead_line ORDER BY product_id, position`,
    ]);

    const bomBy = groupBy(bom, (r) => r.product_id);
    const opsBy = groupBy(ops, (r) => r.product_id);
    const ohBy = groupBy(overheads, (r) => r.product_id);

    return products.map((p) => hydrate(p, bomBy, opsBy, ohBy));
  }

  /**
   * By product code. Two codes appear twice in the library — the same cable
   * costed in two source sheets with identical totals — and this returns the
   * first, matching what the in-memory adapter does.
   */
  async byId(id: string): Promise<Product | undefined> {
    const products = await this.db.$queryRaw<ProductRow[]>`
      SELECT id::text, code, source_sheet, designation, family, standard,
             cores, size_mm2::text AS size_mm2, conductor, insulation,
             screen, armour, sheath, voltage,
             tooling_per_km::text AS tooling_per_km
        FROM product WHERE code = ${id} ORDER BY source_sheet LIMIT 1`;

    const p = products[0];
    if (p === undefined) return undefined;

    const [bom, ops, overheads] = await Promise.all([
      this.db.$queryRaw<BomRow[]>`
        SELECT product_id::text, material_key, material_name,
               consumption::text AS consumption, scrap::text AS scrap
          FROM bom_line WHERE product_id = ${p.id}::uuid ORDER BY position`,
      this.db.$queryRaw<OpRow[]>`
        SELECT product_id::text, machine_key, machine_name, sequence,
               hours_per_km::text AS hours_per_km, cores::text AS cores
          FROM machine_op WHERE product_id = ${p.id}::uuid ORDER BY sequence`,
      this.db.$queryRaw<OverheadRow[]>`
        SELECT product_id::text, key, name, amount::text AS amount
          FROM overhead_line WHERE product_id = ${p.id}::uuid ORDER BY position`,
    ]);

    return hydrate(
      p,
      groupBy(bom, (r) => r.product_id),
      groupBy(ops, (r) => r.product_id),
      groupBy(overheads, (r) => r.product_id),
    );
  }
}

function groupBy<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const list = out.get(k);
    if (list === undefined) out.set(k, [row]);
    else list.push(row);
  }
  return out;
}

function hydrate(
  p: ProductRow,
  bomBy: Map<string, BomRow[]>,
  opsBy: Map<string, OpRow[]>,
  ohBy: Map<string, OverheadRow[]>,
): Product {
  return {
    // The domain's product id is the cost master's code, not the synthetic
    // primary key — that is what appears on a quote and in a URL.
    id: p.code,
    sourceSheet: p.source_sheet,
    designation: p.designation,
    family: p.family,
    spec: {
      cores: p.cores,
      sizeMm2: dec(p.size_mm2),
      conductor: p.conductor,
      insulation: p.insulation,
      screen: p.screen,
      armour: p.armour,
      sheath: p.sheath,
      voltage: p.voltage,
      standard: p.standard,
    },
    toolingPerKm: omrPerKm(p.tooling_per_km),
    bom: (bomBy.get(p.id) ?? []).map((b) => ({
      materialKey: b.material_key,
      materialName: b.material_name,
      consumption: kgPerKm(b.consumption),
      scrap: kgPerKm(b.scrap),
    })),
    operations: (opsBy.get(p.id) ?? []).map((o) => ({
      machineKey: o.machine_key,
      machineName: o.machine_name,
      sequence: o.sequence,
      hoursPerKm: hours(o.hours_per_km),
      cores: dec(o.cores),
    })),
    overheads: (ohBy.get(p.id) ?? []).map((o) => ({
      key: o.key,
      name: o.name,
      amount: omrPerKm(o.amount),
    })),
  };
}
