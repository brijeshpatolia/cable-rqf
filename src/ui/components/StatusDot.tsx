import { TIERS, type Tier } from './tier';

interface StatusDotProps {
  readonly tier: Tier;
  /**
   * The word beside the dot. Default `true` — colour is never the only signal,
   * and the exceptions (a dense inbox column where the word is its own column)
   * must be deliberate.
   */
  readonly withLabel?: boolean;
}

/**
 * The single source of tier meaning on screen. 6px, solid or hollow.
 * The same component renders on the inbox, the review screen, and the quote.
 */
export function StatusDot({ tier, withLabel = true }: StatusDotProps) {
  const def = TIERS[tier];
  const solid = def.fill === 'solid';

  return (
    <span className="inline-flex items-center gap-2" title={def.action}>
      <span
        aria-hidden
        className="inline-block shrink-0 rounded-full"
        style={{
          width: 6,
          height: 6,
          backgroundColor: solid ? def.colorVar : 'transparent',
          boxShadow: solid ? undefined : `inset 0 0 0 1.5px ${def.colorVar}`,
        }}
      />
      {withLabel ? (
        <span
          className="whitespace-nowrap"
          style={{ color: 'var(--color-ink-secondary)' }}
        >
          {def.label}
        </span>
      ) : (
        <span className="sr-only">{def.label}</span>
      )}
      {def.marker === undefined ? null : (
        <span
          className="numeric"
          title="Decided by a person, not by the app"
          style={{
            color: def.colorVar,
            fontSize: 'var(--text-micro)',
            border: `1px solid ${def.colorVar}`,
            borderRadius: 2,
            padding: '0 3px',
            lineHeight: '14px',
          }}
        >
          {def.marker}
        </span>
      )}
    </span>
  );
}

/**
 * The four tiers the app produces on its own.
 *
 * `chosen` and `hand-priced` are left out on purpose: they describe a line a
 * *person* settled, which needs no legend to whoever just settled it, and
 * their `M` marker already says so wherever they appear. `pending` is a
 * transitional state nobody reads a legend for.
 *
 * Stated as a constant rather than inlined so a caller can widen it, and so
 * the omission is a decision on the page rather than an accident in a map.
 */
export const AUTOMATIC_TIERS: readonly Tier[] = ['exact', 'close', 'partial', 'no-match'];

/**
 * Rendered from the same definitions as the dots, so the legend cannot drift.
 *
 * `short` drops the sentence to its first clause — the inbox footer wants
 * "Spot-check", not "Priced automatically. Spot-check."
 */
export function TierLegend({
  tiers = AUTOMATIC_TIERS,
  short = false,
}: {
  readonly tiers?: readonly Tier[];
  readonly short?: boolean;
} = {}) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
      {tiers.map((tier) => (
        <div key={tier} className="flex items-baseline gap-2">
          <StatusDot tier={tier} />
          <span
            style={{
              color: 'var(--color-ink-faint)',
              fontSize: 'var(--text-micro)',
            }}
          >
            {short ? firstClause(TIERS[tier].action) : TIERS[tier].action}
          </span>
        </div>
      ))}
    </div>
  );
}

/** "Not priced. Nearest products shown." → "Not priced" */
function firstClause(action: string): string {
  return action.split('.')[0] ?? action;
}
