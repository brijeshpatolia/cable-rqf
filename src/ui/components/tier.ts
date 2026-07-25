/**
 * The four match tiers, defined once.
 *
 * `StatusDot`, the legend, the inbox, the review screen, and the quote all
 * render from this object — so the same dot cannot come to mean two different
 * things in two places (DESIGN_SYSTEM.md §2).
 *
 * Three status hues, four tiers. Fill carries what hue cannot: solid means the
 * app committed to something, hollow means it declined. Partial and No-match
 * share red because they share a consequence — an engineer costs this by hand.
 */
export type Tier = 'exact' | 'close' | 'partial' | 'no-match' | 'pending';

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
  'close',
  'exact',
  'pending',
];

export function tierRank(tier: Tier): number {
  return TIER_REVIEW_ORDER.indexOf(tier);
}
