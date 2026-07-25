import type { Decimal } from '@/core/decimal';
import type { Product, ResolvedRateSet } from '@/modules/costing';
import type { EffectiveRow } from './effective';
import type { OpenQuote } from '@/modules/pricewatch';

/**
 * Ports.
 *
 * `modules/` declares what it needs; `infra/` implements it. Nothing in this
 * file knows about Prisma, Postgres, or any framework — which is what lets the
 * in-memory adapter used today be swapped for the database adapter of Phase 1's
 * back half without touching a line of business logic (ARCHITECTURE.md §1).
 */

export interface RateRepository {
  /**
   * The whole rate set resolved as of an instant, in one call.
   *
   * Deliberately not `getRate(key)` — costing a 200-line quote must issue one
   * query, not 200. The in-memory adapter honours the same shape so the
   * database adapter can't regress it (ARCHITECTURE.md §5).
   */
  resolveAt(asOf: Date): Promise<ResolvedRateSet>;

  /** Rate rows for the Rate Desk, including closed ones — history is the product. */
  materialRows(): Promise<readonly EffectiveRow<Decimal>[]>;
  machineRows(): Promise<readonly EffectiveRow<Decimal>[]>;

  /** The LME series, most recent first. */
  lmeHistory(limit: number): Promise<readonly LmeTick[]>;
}

export interface LmeTick {
  readonly at: Date;
  readonly lme: Decimal;
  readonly fx: Decimal;
  readonly enteredBy: string;
}

export interface ProductRepository {
  list(): Promise<readonly Product[]>;
  byId(id: string): Promise<Product | undefined>;
}

export interface QuoteRepository {
  open(): Promise<readonly OpenQuote[]>;
}

export interface AuditEvent {
  readonly at: Date;
  readonly actor: string;
  readonly entity: string;
  readonly field: string;
  readonly previous: string;
  readonly next: string;
  readonly reason?: string;
}

export interface AuditRepository {
  forEntity(entity: string, limit: number): Promise<readonly AuditEvent[]>;
  recent(limit: number): Promise<readonly AuditEvent[]>;
}
