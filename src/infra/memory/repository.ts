import type { Decimal } from '@/core/decimal';
import { omrPerHour, omrPerKg, omrPerUSD, usdPerTonne } from '@/core/units';
import type { Product, ResolvedRateSet } from '@/modules/costing/types';
import {
  type EffectiveRow,
  findOverlaps,
  resolveAllAt,
} from '@/modules/rates/effective';
import type {
  AuditRepository,
  AuditEvent,
  LmeTick,
  ProductRepository,
  QuoteRepository,
  RateRepository,
} from '@/modules/rates/ports';
import type { OpenQuote } from '@/modules/pricewatch/drift';
import { RAW_MATERIALS, products as importedProducts } from '@/infra/data';
import {
  AUDIT,
  LME_HISTORY,
  MACHINE_ROWS,
  MATERIAL_ROWS,
  OPEN_QUOTES,
} from './seed';

/**
 * Drawing premiums, by material code. Held alongside the rate rather than in a
 * separate table, because that is how the import found them — one premium per
 * LME-linked copper code.
 */
const PREMIUM_BY_CODE = new Map(
  RAW_MATERIALS.filter((m) => m.drawingPremium !== null).map((m) => [
    m.code,
    m.drawingPremium!,
  ]),
);

const LME_LINKED = new Set(RAW_MATERIALS.filter((m) => m.lmeLinked).map((m) => m.code));

/**
 * The in-memory adapter.
 *
 * Implements the ports declared in `modules/rates/ports.ts`. When the Phase 0
 * import lands and the database adapter replaces this, nothing outside
 * `infra/` changes — that is the whole point of the layering rule.
 *
 * It honours the same contract the database will: one resolution call per
 * costing run, not one per line, and the same no-overlap invariant Postgres
 * enforces with an exclusion constraint.
 */
export class MemoryRateRepository implements RateRepository {
  constructor(
    private readonly materials: readonly EffectiveRow<Decimal>[] = MATERIAL_ROWS,
    private readonly machines: readonly EffectiveRow<Decimal>[] = MACHINE_ROWS,
    private readonly lme: readonly LmeTick[] = LME_HISTORY,
  ) {
    // The invariant the database would enforce, checked at construction so a
    // bad import fails loudly rather than pricing off an ambiguous rate.
    const overlaps = [
      ...findOverlaps(this.materials),
      ...findOverlaps(this.machines),
    ];
    if (overlaps.length > 0) {
      const [first] = overlaps;
      throw new Error(
        `Overlapping rate periods for ${first!.key}: rows ${first!.a} and ${first!.b}. ` +
          'A rate cannot have two values in force at the same instant.',
      );
    }
  }

  async resolveAt(asOf: Date): Promise<ResolvedRateSet> {
    const materials = resolveAllAt(this.materials, asOf);
    const machines = resolveAllAt(this.machines, asOf);

    // The LME tick in force is the most recent one at or before `asOf`.
    const tick =
      this.lme.find((t) => t.at.getTime() <= asOf.getTime()) ?? this.lme[0]!;

    return {
      asOf,
      materials: new Map(
        [...materials].map(([key, row]) => {
          const premium = PREMIUM_BY_CODE.get(key);
          return [
            key,
            {
              rate: omrPerKg(row.value),
              lmeLinked: LME_LINKED.has(key),
              ...(premium !== undefined
                ? { drawingPremium: omrPerKg(premium) }
                : {}),
              source: {
                rateId: row.rateId,
                effectiveFrom: row.validFrom,
                table: row.table,
              },
            },
          ];
        }),
      ),
      machines: new Map(
        [...machines].map(([key, row]) => [
          key,
          {
            rate: omrPerHour(row.value),
            source: {
              rateId: row.rateId,
              effectiveFrom: row.validFrom,
              table: row.table,
            },
          },
        ]),
      ),
      copper: {
        lme: usdPerTonne(tick.lme),
        fx: omrPerUSD(tick.fx),
        source: {
          rateId: `lme-${tick.at.toISOString().slice(0, 10)}`,
          effectiveFrom: tick.at,
          table: 'lme_price',
        },
      },
    };
  }

  async materialRows(): Promise<readonly EffectiveRow<Decimal>[]> {
    return this.materials;
  }

  async machineRows(): Promise<readonly EffectiveRow<Decimal>[]> {
    return this.machines;
  }

  async lmeHistory(limit: number): Promise<readonly LmeTick[]> {
    return this.lme.slice(0, limit);
  }
}

export class MemoryProductRepository implements ProductRepository {
  constructor(private readonly products: readonly Product[] = importedProducts()) {}

  async list(): Promise<readonly Product[]> {
    return this.products;
  }

  async byId(id: string): Promise<Product | undefined> {
    return this.products.find((p) => p.id === id);
  }
}

export class MemoryQuoteRepository implements QuoteRepository {
  constructor(private readonly quotes: readonly OpenQuote[] = OPEN_QUOTES) {}

  async open(): Promise<readonly OpenQuote[]> {
    return this.quotes;
  }
}

export class MemoryAuditRepository implements AuditRepository {
  constructor(private readonly events: readonly AuditEvent[] = AUDIT) {}

  async forEntity(entity: string, limit: number): Promise<readonly AuditEvent[]> {
    return this.events.filter((e) => e.entity === entity).slice(0, limit);
  }

  async recent(limit: number): Promise<readonly AuditEvent[]> {
    return this.events.slice(0, limit);
  }
}

/**
 * The composition root. The only place adapters are chosen — swapping to the
 * database adapter is an edit to this object and nothing else.
 */
export const repositories = {
  rates: new MemoryRateRepository(),
  products: new MemoryProductRepository(),
  quotes: new MemoryQuoteRepository(),
  audit: new MemoryAuditRepository(),
};
