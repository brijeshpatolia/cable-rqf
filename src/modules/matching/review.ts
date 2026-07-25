import { metres } from '@/core/units';
import type {
  CommercialTerms,
  CostBreakdown,
  Product,
  ResolvedRateSet,
} from '@/modules/costing';
import { computeCost } from '@/modules/costing';
import { type MatchResult, isPriceable, matchLine } from './match';
import { type ExtractedLine, parseLine } from './parse';
import { type Bounds, type Violation, validate } from './validate';

/**
 * A job: an RFQ turned into reviewable lines.
 *
 * This module composes parse → match → cost → validate into the shape the
 * review screen renders. It stays pure, so the same call produces the same job
 * every time and the screen can be server-rendered.
 */

/**
 * A line the engineer reviews.
 *
 * The union is the type-level form of the spec's central rule: **an unpriced
 * line has no price field to render, not a null one.** A Partial or No-match
 * line cannot be given a price without changing its type, so no amount of
 * careless rendering can put a number next to one.
 */
export type ReviewLine =
  | {
      readonly index: number;
      readonly extracted: ExtractedLine;
      readonly match: Extract<MatchResult, { tier: 'exact' | 'close' }>;
      readonly product: Product;
      readonly breakdown: CostBreakdown;
      /** Non-empty means the line is held: priced, but not approvable yet. */
      readonly violations: readonly Violation[];
    }
  | {
      readonly index: number;
      readonly extracted: ExtractedLine;
      readonly match: Extract<MatchResult, { tier: 'partial' | 'no-match' }>;
    };

export function isPriced(
  line: ReviewLine,
): line is Extract<ReviewLine, { breakdown: CostBreakdown }> {
  return 'breakdown' in line;
}

/** Held lines are priced but blocked — they must be looked at before approval. */
export function isHeld(line: ReviewLine): boolean {
  return isPriced(line) && line.violations.length > 0;
}

export interface Job {
  readonly lines: readonly ReviewLine[];
  readonly counts: Readonly<Record<'exact' | 'close' | 'partial' | 'no-match', number>>;
  readonly held: number;
  /**
   * Why the job cannot be approved yet, in words. Empty when it can.
   * A disabled action always states its condition.
   */
  readonly blockers: readonly string[];
}

export interface ReviewOptions {
  readonly defaultQuantityMetres?: string;
}

export function reviewJob(
  input: string,
  products: readonly Product[],
  rates: ResolvedRateSet,
  terms: CommercialTerms,
  bounds: Bounds,
  options: ReviewOptions = {},
): Job {
  const { defaultQuantityMetres = '1000' } = options;

  const lines = input
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '')
    .map((raw, index): ReviewLine => {
      const extracted = parseLine(raw);
      const match = matchLine(extracted, products);

      if (!isPriceable(match)) return { index, extracted, match };

      const quantity = {
        metres: metres(extracted.quantityMetres.value ?? defaultQuantityMetres),
      };
      const result = computeCost(match.product, quantity, rates, terms);

      // A line that matched but cannot be costed is not a priced line. It
      // falls back to Partial with the engine's own stated reason rather than
      // appearing as a price the app can't actually support.
      if (!result.ok) {
        return {
          index,
          extracted,
          match: { tier: 'partial', reason: result.error.message, nearest: [] },
        };
      }

      return {
        index,
        extracted,
        match,
        product: match.product,
        breakdown: result.value,
        violations: validate(result.value, match.product, bounds),
      };
    });

  const counts = { exact: 0, close: 0, partial: 0, 'no-match': 0 };
  for (const line of lines) counts[line.match.tier] += 1;

  const held = lines.filter(isHeld).length;

  const blockers: string[] = [];
  const unpriced = counts.partial + counts['no-match'];
  if (unpriced > 0) {
    blockers.push(
      `${unpriced} line${unpriced === 1 ? '' : 's'} still need${unpriced === 1 ? 's' : ''} pricing`,
    );
  }
  if (held > 0) {
    blockers.push(`${held} line${held === 1 ? '' : 's'} held for review`);
  }

  return { lines, counts, held, blockers };
}

/** Review order: the engineer's time goes to red first. */
const TIER_ORDER = ['no-match', 'partial', 'close', 'exact'] as const;

export function byReviewOrder(a: ReviewLine, b: ReviewLine): number {
  const rank = (l: ReviewLine) => TIER_ORDER.indexOf(l.match.tier);
  const d = rank(a) - rank(b);
  return d !== 0 ? d : a.index - b.index;
}
