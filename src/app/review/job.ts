import { metres } from '@/core/units';
import { now } from '@/infra/clock';
import { SOURCE_TERMS } from '@/infra/data';
import { repositories } from '@/infra/repositories';
import { computeCost } from '@/modules/costing';
import { deriveBounds, reviewJob, type Job } from '@/modules/matching';

/**
 * Turning RFQ text into a reviewed job, in one place.
 *
 * Shared by the Review screen and the approve action deliberately. The action
 * is handed the RFQ *text* and re-prices it here rather than being handed
 * prices from the browser — a Server Action is a public endpoint, and a price
 * that arrived over the wire is a price nobody at Nuhas computed.
 *
 * It also means the quote is struck on the rates in force at the instant of
 * approval, not the instant the screen happened to be rendered.
 */

/**
 * A worked example standing in for a pasted RFQ, until Phase 3 puts document
 * extraction in front of this screen. Every tier is represented, because the
 * point of the screen is what it does with the ones it cannot price.
 */
export const SAMPLE_RFQ = [
  '1  3C x 50mm2 Cu XLPE SWA PVC 1kV — 12,000 m',
  '2  4C x 16 sq mm copper, cross linked polyethylene, steel wire armoured, p.v.c, 0.6/1kV — 8,500 m',
  '3  10 Pair x 1.5mm2 Cu XLPE IOSCR FRRT PVC SWA 500V — 2,000 m',
  '4  3C x 55mm2 Cu XLPE SWA PVC 1kV — 1,500 m',
  '5  3C x 50mm2 aluminium XLPE SWA PVC 1kV — 4,000 m',
  '6  3C x 50mm2 Cu XLPE SWA PVC 33kV — 900 m',
  '7  3C x 50mm2 Cu XLPE SWA PVC 1kV with unobtainium bedding — 300 m',
].join('\n');

/**
 * Strips the leading line number a customer's table usually carries.
 *
 * Narrowly, because cable descriptions begin with numbers too: `10 Pair x
 * 1.5mm2 …` is a ten-pair cable, not line 10. A leading integer only counts as
 * an index when it is punctuated like one (`1.`, `1)`, `1:`) or set off by the
 * column gap a pasted table leaves behind — two or more spaces.
 */
const stripIndex = (l: string) => l.replace(/^\s*\d{1,3}(?:[.):]\s+|\s{2,})/, '');

export interface BuiltJob {
  readonly job: Job;
  readonly pricedAt: Date;
}

export async function buildJob(rfq: string): Promise<BuiltJob> {
  const pricedAt = now();
  const { products, rates } = repositories;
  const [rateSet, library] = await Promise.all([
    rates.resolveAt(pricedAt),
    products.list(),
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

  const job = reviewJob(
    rfq.split('\n').map(stripIndex).join('\n'),
    library,
    rateSet,
    SOURCE_TERMS,
    bounds,
  );

  return { job, pricedAt };
}
