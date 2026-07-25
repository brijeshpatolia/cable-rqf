import type {
  AuditRepository,
  ProductRepository,
  QuoteRepository,
  RateRepository,
} from '@/modules/rates';
import { DbProductRepository, DbRateRepository } from './db/repository';
import { DbQuoteRepository } from './db/quote-repository';
import { DbRateWriter } from './db/write-repository';
import {
  MemoryAuditRepository,
  MemoryProductRepository,
  MemoryQuoteRepository,
  MemoryRateRepository,
} from './memory/repository';

/**
 * The composition root — the one place adapters are chosen.
 *
 * ARCHITECTURE.md promised that swapping storage would be "an edit to this
 * object and nothing else". This is that edit: `modules/` never learned what a
 * database is, and no page, screen or test outside `infra/` changed shape.
 *
 * `USE_MEMORY_ADAPTER=1` keeps the in-memory path reachable. It is not dead
 * code kept out of sentiment — it is what lets the app boot and render for a
 * design review with no database at all, and it is exercised by a test so the
 * fallback cannot rot unnoticed.
 */
const useMemory = process.env['USE_MEMORY_ADAPTER'] === '1';

export interface Repositories {
  readonly rates: RateRepository;
  readonly products: ProductRepository;
  readonly quotes: QuoteRepository;
  readonly audit: AuditRepository;
}

export const repositories: Repositories = useMemory
  ? {
      rates: new MemoryRateRepository(),
      products: new MemoryProductRepository(),
      quotes: new MemoryQuoteRepository(),
      audit: new MemoryAuditRepository(),
    }
  : {
      rates: new DbRateRepository(),
      products: new DbProductRepository(),
      quotes: new DbQuoteRepository(),
      // The audit trail has no screen yet, so it keeps the in-memory shape
      // until the phase that gives it one. Named here rather than hidden, so
      // the gap is visible — the rows are being written either way.
      audit: new MemoryAuditRepository(),
    };

/** The rate write path. Only meaningful against the database. */
export const rateWriter = new DbRateWriter();

/**
 * The quote store, beyond the `open()` the price watch needs.
 *
 * Named separately because it has no in-memory counterpart and should not
 * pretend to: a quote is a document with legal weight, and a fake one that
 * evaporates on restart is worse than a screen that says the database is not
 * configured.
 */
export const quoteStore = new DbQuoteRepository();

/** True when the app is reading real data rather than the seeded stand-in. */
export const isDatabaseBacked = !useMemory;
