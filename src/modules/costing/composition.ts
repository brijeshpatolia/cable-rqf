import type { Decimal } from '@/core/decimal';
import type { CostBreakdown } from './types';

/**
 * What a line's rate per km is made of, in four parts.
 *
 * Lives here rather than beside the component that draws it, because it is
 * arithmetic over a `CostBreakdown` and the app's layering says so — the
 * dependency-cruiser rule `ui-holds-no-business-logic` caught it in `ui/` and
 * was right to. The component maps these to colours; it does not decide what
 * the parts are.
 *
 * **The identity this has to satisfy:**
 *
 *     materials + machine + (overheads + tooling) + commercial === unitRate × 1000
 *
 * Tooling is the part that was missing. `costPerKm` is materials + operations
 * + overheads + **tooling** (`engine.ts:154-159`), so a composition summing
 * only the first three and then deriving Commercial from `costPerKm`
 * reconciles to neither figure, and every share is distorted by whatever
 * tooling the product carries.
 *
 * Commercial is derived by subtraction rather than read off the commercial
 * block, because that block is expressed per metre and everything else here is
 * per km — converting between them at this point would put the same arithmetic
 * in a second place.
 *
 * The identity holds *unconditionally*, including when a rate is below cost
 * and Commercial comes out negative. This used to floor that case at zero, on
 * the reasoning that a share cannot be less than none of the total — but the
 * floor made the parts sum to `costPerKm` instead, so the function quietly
 * stopped satisfying the one thing it documents, and the bar's percentages
 * silently changed denominator without changing their label. Caught in review.
 *
 * A negative segment is a real thing to say about a real price: this line is
 * being sold under what it costs to make. Whether that can be *drawn* as a
 * proportional bar is a question for whatever draws it — `CompositionBar`
 * declines, because a stacked bar has no way to express a negative share. The
 * arithmetic's job is to be right, not to be drawable.
 *
 * Below cost is not reachable today: margin comes from the source terms rather
 * than from anything a Rate Owner can type, and `sellPerKm` adds drum, packing
 * and freight on top of a positive margin (`engine.ts:163-173`). It is written
 * to hold anyway, because the day margin becomes editable is not the day to
 * discover that this reconciled by accident.
 */
export interface CostPart {
  readonly key: 'materials' | 'machine' | 'overheads' | 'commercial';
  readonly label: string;
  readonly value: Decimal;
}

export function compositionOf(b: CostBreakdown): readonly CostPart[] {
  const commercial = b.unitRate.times(1000).minus(b.costPerKm);

  return [
    { key: 'materials', label: 'Materials', value: b.materialsSubtotal },
    { key: 'machine', label: 'Machine', value: b.operationsSubtotal },
    {
      key: 'overheads',
      label: 'Overheads & tooling',
      value: b.overheadsSubtotal.plus(b.tooling),
    },
    { key: 'commercial', label: 'Commercial', value: commercial },
  ];
}
