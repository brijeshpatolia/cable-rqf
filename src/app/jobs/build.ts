import { metres } from '@/core/units';
import { now } from '@/infra/clock';
import { SOURCE_TERMS } from '@/infra/data';
import {
  repositories,
  substitutionStore,
  vocabularyStore,
} from '@/infra/repositories';
import { type ResolvedRateSet, computeCost } from '@/modules/costing';
import type { Job as PersistedJob } from '@/modules/jobs';
import { type Job, deriveBounds, reviewJob } from '@/modules/matching';
import type { Strike } from '@/modules/quoting';

/**
 * Turning a stored job into a reviewed one, in one place.
 *
 * Shared by the review screen and the approve action deliberately. The action
 * re-derives the whole job here rather than being handed prices from the
 * browser — a Server Action is a public endpoint, and a price that arrived
 * over the wire is a price nobody at Nuhas computed.
 *
 * Everything that can change between two renders is loaded fresh: the rates in
 * force, the dictionary the Rate Owner has taught, and the substitutions they
 * have declared. Only the customer's text and the humans' decisions are
 * stored. That is what lets a job left open over a copper move reprice rather
 * than quietly go stale.
 */

export interface BuiltJob {
  readonly job: Job;
  readonly pricedAt: Date;
  /** The copper the whole job was resolved against. Stamped on the quote. */
  readonly strike: Strike;
  readonly rateSet: ResolvedRateSet;
}

/**
 * The strike, taken from the rate resolution rather than from any one line.
 *
 * A job's first line may be hand-priced and carry no build-up at all, so a
 * quote whose stamped provenance depended on the order its lines arrived in
 * would be a quote that cannot be reconstructed.
 */
function deriveStrike(rates: ResolvedRateSet): Strike {
  return {
    lme: rates.copper.lme,
    fx: rates.copper.fx,
    marginPercent: SOURCE_TERMS.marginPercent,
  };
}

export async function buildJob(persisted: PersistedJob): Promise<BuiltJob> {
  const pricedAt = now();

  const [rateSet, library, dictionary, substitutions] = await Promise.all([
    repositories.rates.resolveAt(pricedAt),
    repositories.products.list(),
    vocabularyStore.dictionary(),
    substitutionStore.inForce(),
  ]);

  // Which materials reprice with copper comes from the resolved rate set, not
  // from the imported JSON — otherwise this would keep answering from the
  // snapshot after the rate owner edits something.
  const lmeLinked = new Set(
    [...rateSet.materials].filter(([, m]) => m.lmeLinked).map(([code]) => code),
  );

  const bounds = deriveBounds(library, lmeLinked, (p) => {
    const r = computeCost(p, { metres: metres(1000) }, rateSet, SOURCE_TERMS);
    return r.ok ? r.value.unitRate : null;
  });

  const job = reviewJob(persisted.rawText, library, rateSet, SOURCE_TERMS, bounds, {
    decisions: persisted.decisions,
    substitutions,
    dictionary,
  });

  return { job, pricedAt, strike: deriveStrike(rateSet), rateSet };
}
