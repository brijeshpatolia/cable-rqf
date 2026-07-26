import { type Decimal, ZERO, dec } from '@/core/decimal';
import type { LineStatus } from '@/modules/matching';

/**
 * Does the library cover what customers actually ask for?
 *
 * PROJECT_PLAN.md gates Phase 4 — six weeks of constructing a bill of
 * materials from IEC rules for cables the library does not hold — on exactly
 * one number: *"Partial and No-match lines exceed a threshold Nuhas agrees in
 * advance (suggested: >15% of line volume, or >20% of quoted value). If the
 * library covers the demand, this phase is never built. That decision is data,
 * not opinion — the review screen tracks tier distribution from Phase 2 onward
 * precisely so this call can be made on evidence."*
 *
 * It did not. Tier counts were computed per job on render and thrown away, so
 * the plan's own gate was unanswerable — which meant the decision would have
 * been made on whoever's impression was loudest. This module is the arithmetic
 * behind the answer.
 *
 * **Deliberately not a recommendation.** It reports the two shares and whether
 * each is past the threshold, and stops. Which threshold, and whether to spend
 * six weeks on it, is Nuhas's call — the app's job is to make the call
 * answerable, not to make it.
 */

/** One enquiry line, reduced to what the question needs. */
export interface CountedLine {
  readonly status: LineStatus;
  /** What the customer asked for. Null when the reader could not find it. */
  readonly metres: Decimal | null;
}

/**
 * Lines the library could not price.
 *
 * `partial` and `no-match` are the plan's own words. `hand-priced` is not
 * counted with them even though a human had to intervene: a line priced by
 * judgement is one a *construction model* would also have had to guess at, and
 * folding it in would inflate the case for building one.
 */
const UNCOVERED: ReadonlySet<LineStatus> = new Set(['partial', 'no-match']);

export interface Share {
  readonly uncovered: number;
  readonly total: number;
  /** 0–100, or null when there is nothing to divide by. */
  readonly percent: Decimal | null;
  /** True when past the threshold — false, never null, when there is no data. */
  readonly past: boolean;
}

export interface Thresholds {
  /** Share of line count, per the plan's suggestion of 15. */
  readonly volumePercent: number;
  /**
   * Share of metres asked for. The plan suggests 20 for *value*; see below
   * for why this measures quantity instead, and why the number carries over.
   */
  readonly quantityPercent: number;
}

export const SUGGESTED: Thresholds = { volumePercent: 15, quantityPercent: 20 };

export interface Coverage {
  readonly byVolume: Share;
  readonly byQuantity: Share;
  /** Every status, counted, so the shape of the demand is visible too. */
  readonly counts: Readonly<Record<LineStatus, number>>;
  /**
   * True when either threshold is past — the plan says *or*, not *and*.
   *
   * A handful of very long uncovered lines is exactly the case the second
   * threshold exists to catch, and it would be invisible in a line count.
   */
  readonly justified: boolean;
}

const EMPTY_COUNTS: Readonly<Record<LineStatus, number>> = {
  exact: 0,
  close: 0,
  chosen: 0,
  'hand-priced': 0,
  partial: 0,
  'no-match': 0,
};

function share(uncovered: Decimal, total: Decimal, thresholdPercent: number): Share {
  const empty = total.isZero();
  const percent = empty ? null : uncovered.div(total).times(100);
  return {
    uncovered: Number(uncovered.toFixed(0)),
    total: Number(total.toFixed(0)),
    percent,
    // No data is not evidence *for* building something. It is the absence of
    // evidence, and this returns false rather than pretending either way.
    past: percent !== null && percent.greaterThan(thresholdPercent),
  };
}

/**
 * The distribution, and whether it clears the bar.
 *
 * **Why metres and not money.** The plan's second threshold is written as
 * ">20% of quoted value", and taken literally it can never fire: a Partial or
 * No-match line is one nothing could price, so its contribution to quoted
 * value is zero by construction. A screen reporting that share would show
 * 0.0% for ever and look like evidence.
 *
 * Valuing those lines from their nearest candidate would fix the arithmetic
 * and break the rule the whole app is built on — the app does not invent a
 * price for a cable it cannot cost, least of all to justify its own roadmap.
 *
 * So the second measure is the quantity the customer actually asked for,
 * which is stated in the enquiry rather than derived from anything. It carries
 * the same weight the plan intended: it is what separates one 12,000 m line
 * nobody can price from a dozen 50 m ones.
 */
export function coverageOf(
  lines: readonly CountedLine[],
  thresholds: Thresholds = SUGGESTED,
): Coverage {
  const counts: Record<LineStatus, number> = { ...EMPTY_COUNTS };

  let uncoveredLines = 0;
  let uncoveredMetres = ZERO;
  let totalMetres = ZERO;

  for (const line of lines) {
    counts[line.status] += 1;
    const uncovered = UNCOVERED.has(line.status);
    if (uncovered) uncoveredLines += 1;

    // A line whose quantity the reader could not make out is counted in the
    // line share and left out of both sides of the quantity share. Assuming a
    // default would put a number the customer never wrote into the evidence.
    if (line.metres !== null) {
      totalMetres = totalMetres.plus(line.metres);
      if (uncovered) uncoveredMetres = uncoveredMetres.plus(line.metres);
    }
  }

  const byVolume = share(dec(uncoveredLines), dec(lines.length), thresholds.volumePercent);
  const byQuantity = share(uncoveredMetres, totalMetres, thresholds.quantityPercent);

  return {
    byVolume,
    byQuantity,
    counts,
    justified: byVolume.past || byQuantity.past,
  };
}
