import { ZERO, type Decimal } from '@/core/decimal';
import { session } from '@/infra/auth/session';
import { can } from '@/modules/auth';
import { axisLabel } from '@/modules/matching';
import { byReviewOrder, isHeld, isPriced } from '@/modules/matching';
import { ApproveJob } from '@/ui/components/ApproveJob';
import { CostBreakdownView } from '@/ui/components/CostBreakdownView';
import { ExpandableRow } from '@/ui/components/ExpandableRow';
import { NumericCell } from '@/ui/components/NumericCell';
import { Panel } from '@/ui/components/Panel';
import { StatusDot, TierLegend } from '@/ui/components/StatusDot';
import type { Tier } from '@/ui/components/tier';
import { approveJob } from './actions';
import { SAMPLE_RFQ, buildJob } from './job';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Review — Cable Quoting' };

export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ rfq?: string }>;
}) {
  const { rfq: submitted } = await searchParams;
  const rfq = submitted !== undefined && submitted.trim() !== '' ? submitted : SAMPLE_RFQ;

  const [{ job }, actor] = await Promise.all([
    buildJob(rfq),
    session.currentActor(),
  ]);

  const lines = [...job.lines].sort(byReviewOrder);
  const priced = job.lines.filter(isPriced);
  const total = priced.reduce<Decimal>(
    (acc, l) => acc.plus(l.breakdown.lineTotal),
    ZERO,
  );

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
          {/*
            Editable, because until Phase 3 reads the customer's document this
            textarea *is* the intake. A plain GET form: the text goes in the
            URL, the server re-parses and re-prices it, and the result is a
            link an engineer can send to a colleague. Phase 3 replaces this
            with the extracted document, and takes the URL length limit with
            it.
          */}
          <Panel title="RFQ as received" flush>
            <form method="get" action="/review">
              <textarea
                name="rfq"
                defaultValue={rfq}
                rows={8}
                spellCheck={false}
                className="numeric w-full"
                style={{
                  display: 'block',
                  margin: 0,
                  padding: 16,
                  textAlign: 'left',
                  backgroundColor: 'transparent',
                  border: 'none',
                  outline: 'none',
                  resize: 'vertical',
                  color: 'var(--color-ink-secondary)',
                  fontSize: 'var(--text-micro)',
                  lineHeight: '18px',
                }}
              />
              <div
                className="flex items-center justify-between gap-4"
                style={{
                  padding: '8px 16px',
                  borderTop: '1px solid var(--color-line-hairline)',
                }}
              >
                <span
                  style={{
                    color: 'var(--color-ink-tertiary)',
                    fontSize: 'var(--text-micro)',
                  }}
                >
                  One line per item. Quantity in metres at the end of the line.
                </span>
                <button
                  type="submit"
                  style={{
                    border: '1px solid var(--color-line-strong)',
                    borderRadius: 'var(--radius-md)',
                    color: 'var(--color-ink-primary)',
                    padding: '5px 12px',
                    fontSize: 'var(--text-body)',
                    minHeight: 'var(--row-height)',
                  }}
                >
                  Price this
                </button>
              </div>
            </form>
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

            <ApproveJob
              action={approveJob}
              blockers={job.blockers}
              rfq={rfq}
              lineCount={priced.length}
              canApprove={can(actor, 'quote.approve')}
            />
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
