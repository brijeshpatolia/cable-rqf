/**
 * Every state a line can be in, defined once.
 *
 * `StatusDot`, the legend, the inbox, the review screen, and the quote all
 * render from this object — so the same dot cannot come to mean two different
 * things in two places (DESIGN_SYSTEM.md §2).
 *
 * **Still three status hues.** Two states were added when humans got to answer
 * lines the app could not settle, and neither introduced a fourth colour:
 * `chosen` and `hand-priced` are amber, because amber has always meant *a
 * person needs to look at this properly*, and a line somebody overruled the app
 * on is the clearest case of that there is.
 *
 * Fill carries what hue cannot: solid means somebody committed to this, hollow
 * means nobody has. A `marker` distinguishes the two amber human states from
 * the two amber machine ones without spending a colour on it — the spec's
 * small mono `M`, which persists onto the quote and into history.
 */
export type Tier =
  | 'exact'
  | 'close'
  | 'chosen'
  | 'hand-priced'
  | 'partial'
  | 'no-match'
  | 'pending';

export interface TierDefinition {
  readonly tier: Tier;
  /** Always rendered beside the dot. Colour is never the only signal. */
  readonly label: string;
  readonly colorVar: string;
  readonly washVar: string;
  readonly fill: 'solid' | 'hollow';
  /** Whether a line in this tier may carry a price at all. */
  readonly priceable: boolean;
  /** What the engineer is expected to do. Shown in the legend. */
  readonly action: string;
  /**
   * A one-character mono badge beside the dot. `M` marks a line a person
   * decided rather than the app — the spec requires it to persist onto the
   * quote and into history, so it is a property of the state, not of a screen.
   */
  readonly marker?: string;
}

export const TIERS: Readonly<Record<Tier, TierDefinition>> = {
  exact: {
    tier: 'exact',
    label: 'Exact',
    colorVar: 'var(--color-status-exact)',
    washVar: 'var(--color-status-exact-wash)',
    fill: 'solid',
    priceable: true,
    action: 'Priced automatically. Spot-check.',
  },
  close: {
    tier: 'close',
    label: 'Close',
    colorVar: 'var(--color-status-review)',
    washVar: 'var(--color-status-review-wash)',
    fill: 'solid',
    priceable: true,
    action: 'Priced on a substituted material. Check properly.',
  },
  chosen: {
    tier: 'chosen',
    label: 'Chosen',
    colorVar: 'var(--color-status-review)',
    washVar: 'var(--color-status-review-wash)',
    fill: 'solid',
    priceable: true,
    action: 'An engineer named the product. Costed in full — check the swap.',
    marker: 'M',
  },
  'hand-priced': {
    tier: 'hand-priced',
    label: 'By hand',
    colorVar: 'var(--color-status-review)',
    washVar: 'var(--color-status-review-wash)',
    fill: 'solid',
    priceable: true,
    action: 'Priced by judgement. No cost build-up exists for it.',
    marker: 'M',
  },
  partial: {
    tier: 'partial',
    label: 'Partial',
    colorVar: 'var(--color-status-manual)',
    washVar: 'var(--color-status-manual-wash)',
    fill: 'hollow',
    priceable: false,
    action: 'Not priced. Nearest products shown.',
  },
  'no-match': {
    tier: 'no-match',
    label: 'No match',
    colorVar: 'var(--color-status-manual)',
    washVar: 'var(--color-status-manual-wash)',
    fill: 'solid',
    priceable: false,
    action: 'Outside the library. Reason stated.',
  },
  pending: {
    tier: 'pending',
    label: 'Reading',
    colorVar: 'var(--color-status-neutral)',
    washVar: 'transparent',
    fill: 'hollow',
    priceable: false,
    action: 'Not yet evaluated.',
  },
} as const;

/** Review order: the engineer's time goes to red first. */
export const TIER_REVIEW_ORDER: readonly Tier[] = [
  'no-match',
  'partial',
  'hand-priced',
  'chosen',
  'close',
  'exact',
  'pending',
];

/**
 * A line's status is already exactly a tier — this is the identity function
 * with a name, and it exists so the coupling is stated rather than assumed. If
 * the matcher ever grows a state the UI has no dot for, this is where it fails
 * to compile.
 */
export function statusTier(status: Tier): Tier {
  return status;
}

export function tierRank(tier: Tier): number {
  return TIER_REVIEW_ORDER.indexOf(tier);
}
