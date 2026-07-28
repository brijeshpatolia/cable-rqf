import { notFound } from 'next/navigation';
import { formatDate, formatInstant, formatNumber } from '@/core/format';
import { now } from '@/infra/clock';
import { jobStore, quoteStore } from '@/infra/repositories';
import {
  copperMassIsPartial,
  copperMassOf,
  isExpired,
  overriddenCount,
  totalOf,
  uncostedCount,
} from '@/modules/quoting';
import { CostBreakdownView } from '@/ui/components/CostBreakdownView';
import { ExpandableRow } from '@/ui/components/ExpandableRow';
import { NumericCell } from '@/ui/components/NumericCell';
import { Panel, Field } from '@/ui/components/Panel';
import { SupersedeQuote } from '@/ui/components/SupersedeQuote';
import { can } from '@/modules/auth';
import { reopenQuote } from '../actions';
import { requireRead } from '../guard';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ number: string }>;
}) {
  const { number } = await params;
  return { title: `${number} — Cable Quoting` };
}

export default async function QuotePage({
  params,
}: {
  params: Promise<{ number: string }>;
}) {
  const actor = await requireRead();

  const { number } = await params;
  const asOf = now();
  const quote = await quoteStore.byNumber(number);
  if (quote === undefined) notFound();

  // The enquiry behind it, which is what a correction reopens.
  const job = await jobStore.byQuoteNumber(number);

  const lapsed = isExpired(quote, asOf);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <div className="flex items-center" style={{ gap: 8, fontSize: 11.5 }}>
          <a href="/quotes" style={{ color: 'var(--color-ink-secondary)' }}>
            Quotes
          </a>
          <span style={{ color: 'var(--color-ink-faint)' }}>/</span>
          <span className="numeric" style={{ color: 'var(--color-ink-bright)' }}>
            {quote.number}
          </span>
        </div>

        <div
          className="flex flex-wrap items-end justify-between"
          style={{ marginTop: 10, gap: 32 }}
        >
          <div>
            <h1
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 'var(--text-display-lg)',
                lineHeight: 'var(--text-display-lg--line-height)',
                letterSpacing: 'var(--text-display-lg--letter-spacing)',
                fontWeight: 600,
              }}
            >
              {quote.customer}
            </h1>

            {/*
              Metadata as pills rather than a row of labelled fields. They are
              facts about the document, not values to be read off it — the
              values live in the aside — and a pill says "context" where a
              label-over-value block says "data".

              Timestamps are absolute with a timezone, always. Never "2 hours
              ago": a quote is a dated promise and the date is the promise.
            */}
            <div className="flex flex-wrap" style={{ marginTop: 12, gap: '8px 10px' }}>
              <Pill label="Priced" value={formatInstant(quote.pricedAt)} mono />
              <Pill
                label="Valid until"
                value={`${formatDate(quote.validUntil)}${lapsed ? ' — lapsed' : ''}`}
                mono
                {...(lapsed ? { tone: 'review' as const } : {})}
              />
              {quote.createdBy === null ? null : (
                <Pill label="Approved by" value={quote.createdBy} />
              )}
              {overriddenCount(quote.lines) + uncostedCount(quote.lines) === 0 ? null : (
                <Pill
                  label="M"
                  value={`${overriddenCount(quote.lines) + uncostedCount(quote.lines)} line${
                    overriddenCount(quote.lines) + uncostedCount(quote.lines) === 1 ? '' : 's'
                  } priced by hand`}
                  tone="review"
                />
              )}
            </div>
          </div>

          <div className="flex shrink-0" style={{ gap: 8 }}>
            <a href={`/quotes/${quote.number}/pdf`} style={exportButton}>
              PDF
            </a>
            <a href={`/quotes/${quote.number}/xlsx`} style={exportButton}>
              Excel
            </a>
            <a href="/history" style={exportButton}>
              History
            </a>
          </div>
        </div>
      </header>

      <div className="flex flex-wrap items-start" style={{ gap: 24 }}>
        <div className="min-w-0 flex-1">
          <Panel
            title="Lines"
            note="Open a line for its full build-up — every figure to the rate row it came from"
            scale="shell"
            flush
          >
            <div
              className="panel-inset label flex items-center"
              style={{
                padding: '8px 18px',
                gap: 14,
                borderBottom: '1px solid var(--color-line-panel)',
              }}
            >
              <span style={{ width: 9 }} />
              <span className="flex-1">Description</span>
              <span style={{ width: 116, textAlign: 'right' }}>Quantity</span>
              <span style={{ width: 104, textAlign: 'right' }}>Unit rate</span>
              <span style={{ width: 136, textAlign: 'right' }}>Amount</span>
            </div>

            {quote.lines.map((line) => (
              <ExpandableRow
                key={line.position}
                scale="shell"
                summary={
                  <span className="flex items-center" style={{ gap: 14 }}>
                    <span className="min-w-0 flex-1 flex flex-col" style={{ gap: 3 }}>
                      <span className="block truncate">{line.designation}</span>
                      <span
                        className="numeric block"
                        style={{
                          color:
                            line.decision === null
                              ? 'var(--color-ink-tertiary)'
                              : 'var(--color-status-review)',
                          fontSize: 'var(--text-mono-micro)',
                          textAlign: 'left',
                        }}
                      >
                        {line.decision === null
                          ? line.productCode
                          : line.breakdown === null
                            ? 'M · priced by hand'
                            : `M · ${line.productCode}`}
                      </span>
                    </span>
                    <span style={{ width: 116, textAlign: 'right' }}>
                      <NumericCell value={line.quantityMetres} decimals={0} unit="m" />
                    </span>
                    <span style={{ width: 104, textAlign: 'right' }}>
                      <NumericCell value={line.unitRate} kind="unitRate" />
                    </span>
                    <span style={{ width: 136, textAlign: 'right' }}>
                      <NumericCell value={line.lineTotal} kind="total" weight="strong" />
                    </span>
                  </span>
                }
              >
                {line.breakdown === null ? (
                  /*
                    No build-up, because none exists. A hand-priced line is the
                    one figure on a quote no machine can explain, so what shows
                    here is the explanation a person gave — which is exactly
                    why the reason was required before the price was accepted.
                  */
                  <div style={{ padding: '8px 0' }}>
                    <div className="label">Priced by hand</div>
                    <p
                      className="mt-1"
                      style={{
                        color: 'var(--color-ink-secondary)',
                        fontSize: 'var(--text-micro)',
                        lineHeight: 'var(--text-micro--line-height)',
                        maxWidth: 660,
                      }}
                    >
                      {line.decision?.by} set this rate on{' '}
                      {line.decision === null ? '' : formatDate(line.decision.at)} —{' '}
                      {line.decision?.reason}
                    </p>
                    <p
                      className="mt-2"
                      style={{
                        color: 'var(--color-ink-tertiary)',
                        fontSize: 'var(--text-micro)',
                        maxWidth: 660,
                      }}
                    >
                      There is no cost build-up for this line and none was
                      invented. Its copper is excluded from the quote&rsquo;s
                      copper content and from the price watch&rsquo;s exposure.
                    </p>
                  </div>
                ) : (
                  /*
                    The frozen snapshot, not a recomputation. This is what the
                    price was actually built from on the day it was struck.
                  */
                  <>
                    {line.decision === null ? null : (
                      <p
                        style={{
                          color: 'var(--color-status-review)',
                          fontSize: 'var(--text-micro)',
                          lineHeight: 'var(--text-micro--line-height)',
                          maxWidth: 660,
                          paddingBottom: 8,
                        }}
                      >
                        {line.decision.unitRate === null
                          ? `${line.decision.by} chose this product`
                          : `${line.decision.by} set this rate`}{' '}
                        on {formatDate(line.decision.at)} — {line.decision.reason}
                      </p>
                    )}
                    <CostBreakdownView breakdown={line.breakdown} />
                  </>
                )}
              </ExpandableRow>
            ))}
          </Panel>
        </div>

        <aside
          style={{ width: 'var(--aside-width)', flexShrink: 0 }}
          className="flex flex-col"
        >
          {/*
            The total is the largest figure on the screen and it is the only
            one that needs to be. Everything else on this page exists to
            explain it.
          */}
          <div className="panel-shell" style={{ padding: 18, marginBottom: 16 }}>
            <div className="label">Quote total</div>
            <div className="flex items-baseline" style={{ gap: 8, marginTop: 6 }}>
              <span
                className="numeric"
                style={{
                  fontSize: 'var(--text-numeric-xl)',
                  lineHeight: 'var(--text-numeric-xl--line-height)',
                  letterSpacing: 'var(--text-numeric-xl--letter-spacing)',
                  fontWeight: 500,
                }}
              >
                {formatNumber(totalOf(quote.lines), 2)}
              </span>
              <span
                className="numeric"
                style={{ fontSize: 11, color: 'var(--color-ink-tertiary)' }}
              >
                OMR
              </span>
            </div>

            <div
              className="grid"
              style={{
                gridTemplateColumns: '1fr 1fr',
                marginTop: 18,
                paddingTop: 16,
                borderTop: '1px solid var(--color-line-panel)',
                gap: 12,
              }}
            >
              <div>
                <div className="label">Lines</div>
                <div className="numeric" style={{ fontSize: 15, textAlign: 'left' }}>
                  {quote.lines.length}
                </div>
              </div>
              <div>
                <div className="label">Margin</div>
                <div className="numeric" style={{ fontSize: 15, textAlign: 'left' }}>
                  {formatNumber(quote.marginPercent, 1)}%
                </div>
              </div>
            </div>
          </div>

          <Panel title="The strike" scale="shell">
            <div className="flex flex-col gap-3">
              <Field label="LME copper">
                <NumericCell value={quote.lmeStruck} kind="lme" unit="USD/t" />
              </Field>
              <Field label="FX">
                <NumericCell value={quote.fxStruck} kind="fx" unit="OMR/USD" />
              </Field>
              <Field
                label={
                  copperMassIsPartial(quote.lines)
                    ? 'Copper content (at least)'
                    : 'Copper content'
                }
              >
                <NumericCell value={copperMassOf(quote.lines)} decimals={1} unit="kg" />
              </Field>
            </div>
            <p
              className="mt-3"
              style={{
                color: 'var(--color-ink-secondary)',
                fontSize: 'var(--text-micro)',
                lineHeight: 'var(--text-micro--line-height)',
              }}
            >
              This quote was struck on copper at {formatNumber(quote.lmeStruck, 2)}.
              Every figure above can be expanded to the rate row it came from.
            </p>
            {/*
              Stated separately and outside the gate above, because it is a
              different fact and it is true of quotes whose copper figure is
              complete. The engineer looking at this screen is the one who
              needs to know a price on it is not the one the build-up derives.
            */}
            {overriddenCount(quote.lines) > 0 ? (
              <p
                className="mt-2"
                style={{
                  color: 'var(--color-status-review)',
                  fontSize: 'var(--text-micro)',
                  lineHeight: 'var(--text-micro--line-height)',
                }}
              >
                {overriddenCount(quote.lines)} line
                {overriddenCount(quote.lines) === 1 ? ' was' : 's were'} costed by
                the engine and then priced by hand.{' '}
                {overriddenCount(quote.lines) === 1 ? 'Its' : 'Their'} copper is
                in the figure above, but the rate charged is not the one the
                build-up derives — expand the line to see both.
              </p>
            ) : null}
          </Panel>

          {/*
            Its own card, in amber, rather than a paragraph at the foot of the
            strike panel.

            It is a consequence of a match tier — a line nobody costed — which
            is the one thing the app's amber is for, and it changes how the
            figure above it should be read. A caveat that changes the meaning
            of a number should not be quieter than the number.

            `uncostedCount`, never `handPricedCount`: a line the engine costed
            and a person then re-priced has its copper inside the figure above,
            and counting it here would say nobody weighed something that was
            weighed.
          */}
          {copperMassIsPartial(quote.lines) ? (
            <div
              className="mt-4"
              style={{
                padding: '16px 18px',
                borderRadius: 'var(--radius-panel)',
                border: '1px solid rgba(210, 153, 34, 0.28)',
                backgroundColor: 'rgba(210, 153, 34, 0.045)',
              }}
            >
              <div className="flex items-center" style={{ gap: 8 }}>
                <span
                  aria-hidden
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    backgroundColor: 'var(--color-status-review)',
                    flexShrink: 0,
                  }}
                />
                <span
                  style={{
                    fontSize: 'var(--text-body-sm)',
                    fontWeight: 500,
                    color: 'var(--color-status-review)',
                  }}
                >
                  Copper content is a floor
                </span>
              </div>
              <p
                className="mt-2"
                style={{
                  color: 'var(--color-ink-secondary)',
                  fontSize: 11.5,
                  lineHeight: '18px',
                }}
              >
                {uncostedCount(quote.lines)} line
                {uncostedCount(quote.lines) === 1 ? ' was' : 's were'} priced by
                hand with no build-up. Nobody costed{' '}
                {uncostedCount(quote.lines) === 1 ? 'its' : 'their'} copper, so{' '}
                {formatNumber(copperMassOf(quote.lines), 1)} kg is a floor rather
                than a total — and the price watch understates this quote by the
                same amount.
              </p>
            </div>
          ) : null}

          {quote.terms !== null && quote.terms !== '' ? (
            <div className="mt-4">
              <Panel title="Terms" scale="shell">
                <p
                  style={{
                    color: 'var(--color-ink-secondary)',
                    fontSize: 'var(--text-micro)',
                    lineHeight: 'var(--text-micro--line-height)',
                  }}
                >
                  {quote.terms}
                </p>
              </Panel>
            </div>
          ) : null}

          {/*
            Last in the column, deliberately. Correcting a quote is the rarest
            thing anyone does on this screen and the most consequential — a
            customer gets a second document out of it.
          */}
          <div className="mt-4">
            <Panel title="Correcting this quote" scale="shell">
            {quote.supersedes === null ? null : (
              <p className="mb-3" style={{
                color: 'var(--color-ink-secondary)',
                fontSize: 'var(--text-micro)',
                lineHeight: 'var(--text-micro--line-height)',
              }}>
                Supersedes{' '}
                <a href={`/quotes/${quote.supersedes}`} style={{ color: 'var(--color-copper)' }}>
                  {quote.supersedes}
                </a>
                .
              </p>
            )}
            <SupersedeQuote
              action={reopenQuote}
              number={quote.number}
              supersededBy={quote.supersededBy}
              canCorrect={can(actor, 'quote.approve')}
              reference={job?.reference ?? null}
            />
            </Panel>
          </div>
        </aside>
      </div>
    </div>
  );
}

const exportButton: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  border: '1px solid var(--color-line-strong)',
  borderRadius: 'var(--radius-input)',
  color: 'var(--color-ink-primary)',
  padding: '0 14px',
  fontSize: 'var(--text-body-sm)',
  height: 34,
};

/**
 * A fact about the document, not a value on it.
 *
 * The values — total, strike, copper content — live in the aside, where they
 * are read. These are the things you check once on opening: when it was
 * priced, when it lapses, who approved it. `tone="review"` is the app's amber,
 * used here for exactly two states: a quote past its date, and a quote
 * carrying a price a person set.
 */
function Pill({
  label,
  value,
  mono = false,
  tone,
}: {
  readonly label: string;
  readonly value: string;
  readonly mono?: boolean;
  readonly tone?: 'review';
}) {
  const amber = tone === 'review';
  return (
    <span
      className="inline-flex items-center"
      style={{
        height: 26,
        padding: '0 10px',
        gap: 6,
        borderRadius: 'var(--radius-control)',
        fontSize: 11.5,
        backgroundColor: amber
          ? 'var(--color-status-review-wash)'
          : 'var(--color-surface-panel)',
        border: `1px solid ${
          amber ? 'var(--color-status-review)' : 'var(--color-line-panel)'
        }`,
        color: amber ? 'var(--color-status-review)' : 'var(--color-ink-secondary)',
        whiteSpace: 'nowrap',
      }}
    >
      <span className={amber ? 'numeric' : undefined}>{label}</span>
      <span
        className={mono ? 'numeric' : undefined}
        style={{ color: amber ? 'var(--color-status-review)' : 'var(--color-ink-bright)' }}
      >
        {value}
      </span>
    </span>
  );
}
