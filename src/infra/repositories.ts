import type {
  AuditRepository,
  ProductRepository,
  QuoteRepository,
  RateRepository,
} from '@/modules/rates';
import { DbAuditRepository } from './db/audit-repository';
import { DbProductRepository, DbRateRepository } from './db/repository';
import { DbCatalogueRepository } from './db/catalogue-repository';
import { DbJobRepository } from './db/job-repository';
import { DbQuoteRepository } from './db/quote-repository';
import { DbSubstitutionRepository } from './db/substitution-repository';
import { DbVocabularyRepository } from './db/vocabulary-repository';
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
      audit: new DbAuditRepository(),
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

/**
 * The three stores behind the human-in-the-loop path.
 *
 * Named separately from `repositories` for the same reason `quoteStore` is:
 * they have no in-memory counterpart and should not pretend to. A learned word
 * or a declared substitution that evaporates on restart is worse than a screen
 * that says the database is not configured — the whole value of both is that
 * somebody's decision persisted.
 */
export const jobStore = new DbJobRepository();
export const vocabularyStore = new DbVocabularyRepository();
export const substitutionStore = new DbSubstitutionRepository();

/** The product library's write path — designs and new item codes. */
export const catalogueStore = new DbCatalogueRepository();

/**
 * The trail, for the history screen.
 *
 * Named separately from `repositories.audit` only because the screen needs
 * `count()`, which is not on the port and should not be: the port exists so
 * `modules/` can record and read events without knowing what a database is,
 * and "how many rows are there in total" is a question only a paginating
 * screen asks.
 */
export const auditStore = new DbAuditRepository();

/** True when the app is reading real data rather than the seeded stand-in. */
export const isDatabaseBacked = !useMemory;
