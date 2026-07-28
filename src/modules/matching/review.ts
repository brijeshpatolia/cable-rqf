import { type Decimal, ZERO } from '@/core/decimal';
import { metres, omr, type OMR } from '@/core/units';
import type {
  CommercialTerms,
  CostBreakdown,
  Product,
  ResolvedRateSet,
} from '@/modules/costing';
import { computeCost } from '@/modules/costing';
import {
  type Candidate,
  type MatchResult,
  type SubstitutionRule,
  differencesBetween,
  isPriceable,
  matchLine,
} from './match';
import { type ExtractedLine, parseLine } from './parse';
import type { Dictionary } from './vocabulary';
import { type Bounds, type Violation, validate } from './validate';

/**
 * A job: an RFQ turned into reviewable lines.
 *
 * This module composes parse → match → cost → validate into the shape the
 * review screen renders, and folds in the decisions a human has already made
 * about the lines the machine could not settle.
 *
 * Still pure. The decisions arrive as data, so the same job text plus the same
 * decisions produces the same job every time and the screen can be
 * server-rendered — which is also what lets the approve action recompute the
 * whole thing server-side rather than trusting prices from a browser.
 */

/**
 * A price an engineer set by hand, and why.
 *
 * `reason` is required by the type because it is required by the business. A
 * hand price is the one figure on a quote no machine can explain, so the
 * explanation travels with it.
 */
export interface Override {
  readonly unitRate: Decimal;
  readonly reason: string;
  readonly by: string;
  readonly at: Date;
}

/** An engineer's decision to price a line as a particular product. */
export interface ProductChoice {
  readonly productCode: string;
  readonly sourceSheet: string;
  readonly reason: string;
  readonly by: string;
  readonly at: Date;
}

/** Everything a human has decided about one line of the job. */
export interface LineDecision {
  readonly position: number;
  readonly override?: Override;
  readonly choice?: ProductChoice;
}

/**
 * What a line is, once the machine and the human have both had their say.
 *
 * - `exact` / `close` — the matcher settled it, the engine costed it
 * - `chosen` — the matcher could not settle it and an engineer named the
 *   product; the engine then costed it normally, so the price is still
 *   explainable down to the kilogram
 * - `hand-priced` — nobody costed it; an engineer set the rate and said why
 * - `partial` / `no-match` — still open, and carrying no price
 */
export type LineStatus =
  | 'exact'
  | 'close'
  | 'chosen'
  | 'hand-priced'
  | 'partial'
  | 'no-match';

interface LineBase {
  readonly index: number;
  readonly extracted: ExtractedLine;
  /** What the matcher made of it, kept even after a human overrules it. */
  readonly match: MatchResult;
}

/**
 * A line the engineer reviews.
 *
 * The union is the type-level form of the spec's central rule: **an open line
 * has no price field to render, not a null one.** `partial` and `no-match`
 * carry no `unitRate`, so no amount of careless rendering can put a number
 * next to one — and the only way for a line to acquire a price without a cost
 * build-up is to carry an `Override`, which cannot be constructed without a
 * reason.
 */
export type ReviewLine =
  | (LineBase & {
      readonly status: 'exact' | 'close' | 'chosen';
      readonly product: Product;
      readonly breakdown: CostBreakdown;
      /** Non-empty means the line is held: priced, but not approvable yet. */
      readonly violations: readonly Violation[];
      /** Set when an engineer replaced the engine's price. */
      readonly override: Override | null;
      /** Set on `chosen`: why this product, and who said so. */
      readonly choice: ProductChoice | null;
      /** How the chosen product differs from what was asked for. */
      readonly differences: readonly AxisDifferenceView[];
      readonly unitRate: Decimal;
      readonly lineTotal: OMR;
    })
  | (LineBase & {
      readonly status: 'hand-priced';
      readonly override: Override;
      readonly unitRate: Decimal;
      readonly lineTotal: OMR;
    })
  | (LineBase & {
      readonly status: 'partial' | 'no-match';
    });

/** Re-exported so screens can name a difference without importing the matcher. */
export type AxisDifferenceView = ReturnType<typeof differencesBetween>[number];

export function isPriced(
  line: ReviewLine,
): line is Extract<ReviewLine, { unitRate: Decimal }> {
  return 'unitRate' in line;
}

/** True when there is a cost build-up to expand. A hand price has none. */
export function hasBreakdown(
  line: ReviewLine,
): line is Extract<ReviewLine, { breakdown: CostBreakdown }> {
  return 'breakdown' in line;
}

/** Held lines are priced but blocked — they must be looked at before approval. */
export function isHeld(line: ReviewLine): boolean {
  return hasBreakdown(line) && line.violations.length > 0;
}

/** True when a person, not the engine, decided this line's price. */
export function isManual(line: ReviewLine): boolean {
  return 'override' in line && line.override !== null;
}

export interface Job {
  readonly lines: readonly ReviewLine[];
  readonly counts: Readonly<Record<LineStatus, number>>;
  readonly held: number;
  /** Lines whose price a human set or whose product a human picked. */
  readonly decided: number;
  /**
   * Why the job cannot be approved yet, in words. Empty when it can.
   * A disabled action always states its condition.
   */
  readonly blockers: readonly string[];
  /** Phrases the dictionary did not recognise, across the whole job. */
  readonly unknownTerms: readonly string[];
}

export interface ReviewOptions {
  readonly defaultQuantityMetres?: string;
  /** What humans have already decided, keyed by line position. */
  readonly decisions?: readonly LineDecision[];
  /** The Rate Owner's allowlist. Empty means no line can ever tier Close. */
  readonly substitutions?: readonly SubstitutionRule[];
  /** Built-ins plus whatever the Rate Owner has taught it since. */
  readonly dictionary?: Dictionary;
}

export function reviewJob(
  input: string,
  products: readonly Product[],
  rates: ResolvedRateSet,
  terms: CommercialTerms,
  bounds: Bounds,
  options: ReviewOptions = {},
): Job {
  const {
    defaultQuantityMetres = '1000',
    decisions = [],
    substitutions = [],
    dictionary,
  } = options;

  const byPosition = new Map(decisions.map((d) => [d.position, d]));

  const lines = input
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '')
    .map((raw, index): ReviewLine => {
      const extracted = parseLine(raw, dictionary);
      const match = matchLine(extracted, products, { substitutions });
      const decision = byPosition.get(index);

      const quantity = {
        metres: metres(extracted.quantityMetres.value ?? defaultQuantityMetres),
      };

      // ── An engineer named the product ──────────────────────────────────
      //
      // Checked before the matcher's own verdict, because a human choice is
      // the whole point of the review screen. The engine still does the
      // costing, so a chosen line is as explainable as an exact one.
      if (decision?.choice !== undefined) {
        const chosen = products.find(
          (p) =>
            p.id === decision.choice!.productCode &&
            (p.sourceSheet ?? '') === decision.choice!.sourceSheet,
        );
        if (chosen !== undefined) {
          const costed = computeCost(chosen, quantity, rates, terms);
          if (costed.ok) {
            return finish({
              index,
              extracted,
              match,
              status: 'chosen',
              product: chosen,
              breakdown: costed.value,
              violations: validate(costed.value, chosen, bounds),
              choice: decision.choice,
              differences: differencesBetween(extracted, chosen),
              override: decision.override ?? null,
              quantityMetres: quantity.metres,
            });
          }
        }
        // A choice that no longer resolves — the product was renamed, or it
        // stopped costing — falls through rather than silently pricing on
        // something else.
      }

      // ── The matcher settled it ─────────────────────────────────────────
      if (isPriceable(match)) {
        const costed = computeCost(match.product, quantity, rates, terms);

        // A line that matched but cannot be costed is not a priced line. It
        // falls back to Partial with the engine's own stated reason rather
        // than appearing as a price the app can't actually support.
        if (costed.ok) {
          return finish({
            index,
            extracted,
            match,
            status: match.tier,
            product: match.product,
            breakdown: costed.value,
            violations: validate(costed.value, match.product, bounds),
            choice: null,
            differences: [],
            override: decision?.override ?? null,
            quantityMetres: quantity.metres,
          });
        }

        const failed: MatchResult = {
          tier: 'partial',
          reason: costed.error.message,
          nearest: [],
        };
        return decision?.override !== undefined
          ? handPriced(index, extracted, failed, decision.override, quantity.metres)
          : { index, extracted, match: failed, status: 'partial' };
      }

      // ── Nobody costed it, but somebody priced it ───────────────────────
      if (decision?.override !== undefined) {
        return handPriced(index, extracted, match, decision.override, quantity.metres);
      }

      return { index, extracted, match, status: match.tier };
    });

  const counts: Record<LineStatus, number> = {
    exact: 0,
    close: 0,
    chosen: 0,
    'hand-priced': 0,
    partial: 0,
    'no-match': 0,
  };
  for (const line of lines) counts[line.status] += 1;

  const held = lines.filter(isHeld).length;
  const decided = lines.filter(
    (l) => isManual(l) || ('choice' in l && l.choice !== null),
  ).length;

  const blockers: string[] = [];
  const open = counts.partial + counts['no-match'];
  if (open > 0) {
    blockers.push(
      `${open} line${open === 1 ? '' : 's'} still need${open === 1 ? 's' : ''} pricing`,
    );
  }
  if (held > 0) {
    blockers.push(`${held} line${held === 1 ? '' : 's'} held for review`);
  }

  const unknownTerms = [
    ...new Set(lines.flatMap((l) => l.extracted.unknownTerms)),
  ].sort();

  return { lines, counts, held, decided, blockers, unknownTerms };
}

/** Applies an override to a costed line and computes the money once. */
function finish(parts: {
  index: number;
  extracted: ExtractedLine;
  match: MatchResult;
  status: 'exact' | 'close' | 'chosen';
  product: Product;
  breakdown: CostBreakdown;
  violations: readonly Violation[];
  choice: ProductChoice | null;
  differences: readonly AxisDifferenceView[];
  override: Override | null;
  quantityMetres: Decimal;
}): ReviewLine {
  const unitRate = parts.override?.unitRate ?? parts.breakdown.unitRate;
  return {
    index: parts.index,
    extracted: parts.extracted,
    match: parts.match,
    status: parts.status,
    product: parts.product,
    breakdown: parts.breakdown,
    violations: parts.violations,
    choice: parts.choice,
    differences: parts.differences,
    override: parts.override,
    unitRate,
    lineTotal: omr(unitRate.times(parts.quantityMetres)),
  };
}

function handPriced(
  index: number,
  extracted: ExtractedLine,
  match: MatchResult,
  override: Override,
  quantityMetres: Decimal,
): ReviewLine {
  return {
    index,
    extracted,
    match,
    status: 'hand-priced',
    override,
    unitRate: override.unitRate,
    lineTotal: omr(override.unitRate.times(quantityMetres)),
  };
}

/** The priced value of a job, ignoring lines still open. */
export function pricedValueOf(lines: readonly ReviewLine[]): OMR {
  return omr(
    lines.reduce<Decimal>(
      (acc, l) => (isPriced(l) ? acc.plus(l.lineTotal) : acc),
      ZERO,
    ),
  );
}

/**
 * Review order: the engineer's time goes to red first.
 *
 * Decided lines sink below untouched ones of the same colour — once a human
 * has answered a line it stops being the thing to look at.
 */
const STATUS_ORDER: readonly LineStatus[] = [
  'no-match',
  'partial',
  'hand-priced',
  'chosen',
  'close',
  'exact',
];

export function byReviewOrder(a: ReviewLine, b: ReviewLine): number {
  const rank = (l: ReviewLine) => STATUS_ORDER.indexOf(l.status);
  const d = rank(a) - rank(b);
  return d !== 0 ? d : a.index - b.index;
}

/**
 * The worst line on an enquiry — what the Inbox shows in one cell.
 *
 * The same ordering the review screen sorts by, so the word in the list and
 * the first row you land on after clicking it are always the same thing. An
 * enquiry is only as good as its worst line: nine Exact lines and one No match
 * is a job that needs a person, and reporting it as Exact would be the list
 * quietly disagreeing with the screen behind it.
 *
 * Undefined for an enquiry with no lines, which is not the same as a good one.
 */
export function worstStatus(lines: readonly ReviewLine[]): LineStatus | undefined {
  let worst: LineStatus | undefined;
  for (const line of lines) {
    if (worst === undefined || STATUS_ORDER.indexOf(line.status) < STATUS_ORDER.indexOf(worst)) {
      worst = line.status;
    }
  }
  return worst;
}

export type { Candidate };
