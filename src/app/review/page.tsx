import { metres } from '@/core/units';
import { SOURCE_TERMS } from '@/infra/data';
import { repositories } from '@/infra/repositories';
import { now } from '@/infra/clock';
import { computeCost } from '@/modules/costing';
import { axisLabel } from '@/modules/matching';
import { byReviewOrder, isHeld, isPriced, reviewJob } from '@/modules/matching';
import { deriveBounds } from '@/modules/matching';
import { CostBreakdownView } from '@/ui/components/CostBreakdownView';
import { ExpandableRow } from '@/ui/components/ExpandableRow';
import { NumericCell } from '@/ui/components/NumericCell';
import { Panel } from '@/ui/components/Panel';
import { StatusDot, TierLegend } from '@/ui/components/StatusDot';
import type { Tier } from '@/ui/components/tier';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Review — Cable Quoting' };

/**
 * A worked example standing in for a pasted RFQ, until Phase 3 puts document
 * extraction in front of this screen. Every tier is represented, because the
 * point of the screen is what it does with the ones it cannot price.
 */
const SAMPLE_RFQ = [
  '1  3C x 50mm2 Cu XLPE SWA PVC 1kV — 12,000 m',
  '2  4C x 16 sq mm copper, cross linked polyethylene, steel wire armoured, p.v.c, 0.6/1kV — 8,500 m',
  '3  10 Pair x 1.5mm2 Cu XLPE IOSCR FRRT PVC SWA 500V — 2,000 m',
  '4  3C x 55mm2 Cu XLPE SWA PVC 1kV — 1,500 m',
  '5  3C x 50mm2 aluminium XLPE SWA PVC 1kV — 4,000 m',
  '6  3C x 50mm2 Cu XLPE SWA PVC 33kV — 900 m',
  '7  3C x 50mm2 Cu XLPE SWA PVC 1kV with unobtainium bedding — 300 m',
].join('\n');

/** Strips the leading line number a customer's table usually carries. */
const stripIndex = (l: string) => l.replace(/^\d+\s+/, '');

export default async function ReviewPage() {
  const asOf = now();
  const { products, rates } = repositories;
  const [rateSet, library] = await Promise.all([
    rates.resolveAt(asOf),
    products.list(),
  ]);

  // Which materials reprice with copper comes from the resolved rate set, not
  // from the imported JSON — otherwise this screen would keep answering from
  // the snapshot after the rate owner edits something.
  const lmeLinked = new Set(
    [...rateSet.materials]
      .filter(([, m]) => m.lmeLinked)
      .map(([code]) => code),
  );
  const bounds = deriveBounds(library, lmeLinked, (p) => {
    const r = computeCost(p, { metres: metres(1000) }, rateSet, SOURCE_TERMS);
    return r.ok ? r.value.unitRate : null;
  });

  const job = reviewJob(
    SAMPLE_RFQ.split('\n').map(stripIndex).join('\n'),
    library,
    rateSet,
    SOURCE_TERMS,
    bounds,
  );

  const lines = [...job.lines].sort(byReviewOrder);
  const total = job.lines
    .filter(isPriced)
    .reduce((acc, l) => acc.plus(l.breakdown.lineTotal), rateSet.copper.lme.times(0));

  return (
    <div style={{ padding: 24 }} className="flex flex-col gap-6">
      <header>
        <h1
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'var(--text-display-lg)',
            lineHeight: 'var(--text-display-lg--line-height)',
            letterSpacing: 'var(--text-display-lg--letter-spacing)',
            fontWeight: 500,
          }}
        >
          Review
        </h1>
        <p className="mt-2" style={{ color: 'var(--color-ink-secondary)', maxWidth: 640 }}>
          Every line of the job with its status, matched product, quantity, and
          price. Green to spot-check, amber to check properly, red to cost by
          hand.
        </p>
      </header>

      <div className="flex gap-6">
        <div className="min-w-0 flex-1 flex flex-col gap-6">
          <Panel title="RFQ as received" flush>
            <pre
              className="numeric"
              style={{
                margin: 0,
                padding: 16,
                textAlign: 'left',
                color: 'var(--color-ink-secondary)',
                fontSize: 'var(--text-micro)',
                lineHeight: '18px',
                whiteSpace: 'pre-wrap',
              }}
            >
              {SAMPLE_RFQ}
            </pre>
          </Panel>

          <Panel
            title="Lines"
            flush
            aside={
              <span
                className="numeric"
                style={{
                  color: 'var(--color-ink-tertiary)',
                  fontSize: 'var(--text-micro)',
                }}
              >
                {job.lines.length} lines · red first
              </span>
            }
          >
            <div
              className="label flex items-center gap-3"
              style={{
                padding: '6px 12px',
                borderBottom: '1px solid var(--color-line-strong)',
              }}
            >
              <span style={{ width: 8 }} />
              <span style={{ width: 96 }}>Status</span>
              <span className="flex-1">Line</span>
              <span style={{ width: 110, textAlign: 'right' }}>Quantity</span>
              <span style={{ width: 100, textAlign: 'right' }}>Unit rate</span>
              <span style={{ width: 120, textAlign: 'right' }}>Total</span>
            </div>

            {lines.map((line) => {
              const tier = line.match.tier as Tier;

              const summary = (
                <span className="flex items-center gap-3">
                  <span style={{ width: 96 }}>
                    <StatusDot tier={tier} />
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {line.extracted.raw}
                  </span>
                  <span style={{ width: 110, textAlign: 'right' }}>
                    <NumericCell
                      value={line.extracted.quantityMetres.value}
                      decimals={0}
                      unit="m"
                    />
                  </span>
                  <span style={{ width: 100, textAlign: 'right' }}>
                    <NumericCell
                      value={isPriced(line) ? line.breakdown.unitRate : null}
                      kind="unitRate"
                    />
                  </span>
                  <span style={{ width: 120, textAlign: 'right' }}>
                    <NumericCell
                      value={isPriced(line) ? line.breakdown.lineTotal : null}
                      kind="total"
                      weight="strong"
                    />
                  </span>
                </span>
              );

              return (
                <ExpandableRow key={line.index} summary={summary}>
                  {isPriced(line) ? (
                    <div>
                      <Matched>
                        Matched to{' '}
                        <span className="numeric">{line.product.id}</span> —{' '}
                        {line.product.designation}
                      </Matched>

                      {line.match.tier === 'close' ? (
                        <Note tone="review">
                          {line.match.difference.requested} ←{' '}
                          {line.match.difference.held}{' '}
                          {axisLabel(line.match.difference.axis)}.{' '}
                          {line.match.substitution.rationale}
                        </Note>
                      ) : null}

                      {isHeld(line)
                        ? line.violations.map((v) => (
                            <Note key={v.code} tone="manual">
                              {v.message}
                            </Note>
                          ))
                        : null}

                      <div className="mt-2">
                        <CostBreakdownView breakdown={line.breakdown} />
                      </div>
                    </div>
                  ) : (
                    <div>
                      <Note tone="manual">{line.match.reason}</Note>

                      {line.match.tier === 'partial' &&
                      line.match.nearest.length > 0 ? (
                        <div className="mt-3">
                          <div className="label" style={{ marginBottom: 6 }}>
                            Nearest costed products
                          </div>
                          {line.match.nearest.map((c) => (
                            <div
                              key={c.product.id}
                              className="flex items-baseline gap-3"
                              style={{
                                padding: '4px 0',
                                borderTop: '1px solid var(--color-line-hairline)',
                              }}
                            >
                              <a
                                href={`/catalogue/${c.product.id}`}
                                className="numeric"
                                style={{
                                  width: 190,
                                  color: 'var(--color-ink-secondary)',
                                  fontSize: 'var(--text-micro)',
                                }}
                              >
                                {c.product.id}
                              </a>
                              <span className="min-w-0 flex-1 truncate">
                                {c.product.designation}
                              </span>
                              <span
                                style={{
                                  color: 'var(--color-ink-tertiary)',
                                  fontSize: 'var(--text-micro)',
                                }}
                              >
                                differs on{' '}
                                {c.differences.map((d) => axisLabel(d.axis)).join(', ')}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : null}

                      <Note tone="quiet">
                        This line is not priced. The app refuses rather than
                        guessing — twenty minutes of an engineer costs less than
                        the margin on the order.
                      </Note>
                    </div>
                  )}
                </ExpandableRow>
              );
            })}
          </Panel>
        </div>

        <aside style={{ width: 300 }} className="shrink-0 flex flex-col gap-6">
          <Panel title="This job">
            <div className="flex flex-col gap-4">
              {(['exact', 'close', 'partial', 'no-match'] as const).map((t) => (
                <div key={t} className="flex items-baseline justify-between">
                  <StatusDot tier={t} />
                  <span className="numeric">{job.counts[t]}</span>
                </div>
              ))}

              <div
                style={{
                  borderTop: '1px solid var(--color-line-strong)',
                  paddingTop: 12,
                }}
              >
                <span className="label">Priced value</span>
                <div className="mt-1">
                  <NumericCell
                    value={total}
                    kind="total"
                    unit="OMR"
                    weight="strong"
                    size="numeric-lg"
                  />
                </div>
              </div>
            </div>

            {/*
              The approve action always states its condition. It never sits
              grey and silent (DESIGN_SYSTEM.md §9).
            */}
            <button
              type="button"
              disabled={job.blockers.length > 0}
              className="mt-5 w-full"
              style={{
                backgroundColor:
                  job.blockers.length > 0
                    ? 'var(--color-surface-raised)'
                    : 'var(--color-copper)',
                color:
                  job.blockers.length > 0
                    ? 'var(--color-ink-tertiary)'
                    : 'var(--color-ink-on-copper)',
                border:
                  job.blockers.length > 0
                    ? '1px solid var(--color-line-hairline)'
                    : 'none',
                borderRadius: 'var(--radius-md)',
                padding: '8px 12px',
                fontWeight: 550,
                minHeight: 'var(--row-height)',
                cursor: job.blockers.length > 0 ? 'not-allowed' : 'pointer',
              }}
            >
              {job.blockers.length > 0
                ? `Approve — ${job.blockers.join(', ')}`
                : 'Approve job'}
            </button>
          </Panel>

          <Panel title="Match tiers">
            <TierLegend />
          </Panel>
        </aside>
      </div>
    </div>
  );
}

function Matched({ children }: { readonly children: React.ReactNode }) {
  return (
    <div
      style={{
        color: 'var(--color-ink-secondary)',
        fontSize: 'var(--text-micro)',
        paddingBottom: 4,
      }}
    >
      {children}
    </div>
  );
}

function Note({
  tone,
  children,
}: {
  readonly tone: 'review' | 'manual' | 'quiet';
  readonly children: React.ReactNode;
}) {
  const color =
    tone === 'review'
      ? 'var(--color-status-review)'
      : tone === 'manual'
        ? 'var(--color-status-manual)'
        : 'var(--color-ink-tertiary)';

  return (
    <p
      className="mt-2"
      style={{
        color,
        fontSize: 'var(--text-micro)',
        lineHeight: 'var(--text-micro--line-height)',
        maxWidth: 640,
      }}
    >
      {children}
    </p>
  );
}
