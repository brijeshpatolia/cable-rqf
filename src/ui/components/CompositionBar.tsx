import { type Decimal, ZERO } from '@/core/decimal';
import { compositionOf, type CostPart } from '@/modules/costing';
import type { CostBreakdown } from '@/modules/costing';

/**
 * What a line's rate is made of.
 *
 * The one piece of data visualisation in the app, and it is here on sufferance:
 * it states nothing the four subtotals below it do not already state, in
 * figures, to three decimal places. What it adds is the *shape* — that this
 * cable is three-quarters copper and that one is half machine time — which is
 * the thing an engineer forms an intuition about over a year and which no
 * column of numbers hands over at a glance.
 *
 * It introduces no colour. Materials take the accent because materials are
 * where copper lives and copper is what this app is about; everything else is
 * grey. If it ever reads as decoration, delete it — the numbers are the record
 * and this is only a way in to them.
 *
 * Percentages are of `costPerKm`, not of the unit rate, because commercial
 * terms are applied on top of that figure rather than being a slice of it.
 */

/**
 * Which grey each part takes. Materials gets the accent because materials are
 * where copper lives; the rest are grey. The parts themselves — and the
 * arithmetic that makes them reconcile to the unit rate — belong to
 * `modules/costing`, not here.
 */
const COLOUR: Readonly<Record<CostPart['key'], string>> = {
  materials: 'var(--color-copper)',
  machine: 'var(--color-composition-machine)',
  overheads: 'var(--color-composition-overhead)',
  commercial: 'var(--color-ink-secondary)',
};

export function CompositionBar({ breakdown }: { readonly breakdown: CostBreakdown }) {
  const segments = compositionOf(breakdown).map((p) => ({ ...p, color: COLOUR[p.key] }));

  const total = segments.reduce<Decimal>((acc, s) => acc.plus(s.value), ZERO);
  if (!total.greaterThan(ZERO)) return null;

  const shares = segments.map((s) => ({
    ...s,
    percent: Number(s.value.dividedBy(total).times(100).toFixed(1)),
  }));

  return (
    <div style={{ paddingBottom: 14 }}>
      <div
        className="flex"
        style={{ height: 8, gap: 3 }}
        role="img"
        aria-label={shares.map((s) => `${s.label} ${s.percent}%`).join(', ')}
      >
        {shares
          .filter((s) => s.percent > 0)
          .map((s) => (
            <span
              key={s.label}
              style={{
                flexGrow: s.percent,
                // A floor, so a 1% share reads as a sliver rather than as a
                // dot that looks like a rendering artefact. The bar stays
                // proportional above it; the exact figure is in the legend
                // underneath either way.
                minWidth: 6,
                backgroundColor: s.color,
                borderRadius: 4,
              }}
            />
          ))}
      </div>

      <div className="flex flex-wrap" style={{ gap: '6px 20px', marginTop: 8 }}>
        {shares.map((s) => (
          <span key={s.label} className="flex items-center" style={{ gap: 6 }}>
            <span
              aria-hidden
              style={{
                width: 6,
                height: 6,
                borderRadius: 2,
                backgroundColor: s.color,
                flexShrink: 0,
              }}
            />
            <span style={{ fontSize: 11, color: 'var(--color-ink-secondary)' }}>
              {s.label}
            </span>
            <span
              className="numeric"
              style={{ fontSize: 11, color: 'var(--color-ink-tertiary)' }}
            >
              {s.percent.toFixed(1)}%
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
