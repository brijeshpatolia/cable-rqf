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
    </span>
  );
}

/** Rendered from the same definitions, so the legend can never drift. */
export function TierLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
      {(['exact', 'close', 'partial', 'no-match'] as const).map((tier) => (
        <div key={tier} className="flex items-baseline gap-2">
          <StatusDot tier={tier} />
          <span
            style={{
              color: 'var(--color-ink-tertiary)',
              fontSize: 'var(--text-micro)',
            }}
          >
            {TIERS[tier].action}
          </span>
        </div>
      ))}
    </div>
  );
}
