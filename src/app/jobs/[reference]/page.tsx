import { notFound, redirect } from 'next/navigation';
import { formatInstant } from '@/core/format';
import { session } from '@/infra/auth/session';
import { jobStore } from '@/infra/repositories';
import { can } from '@/modules/auth';
import { statusLabel } from '@/modules/jobs';
import {
  type ReviewLine,
  axisLabel,
  byReviewOrder,
  hasBreakdown,
  isHeld,
  isPriced,
  pricedValueOf,
} from '@/modules/matching';
import { ApproveJob } from '@/ui/components/ApproveJob';
import { CostBreakdownView } from '@/ui/components/CostBreakdownView';
import { ExpandableRow } from '@/ui/components/ExpandableRow';
import { NumericCell } from '@/ui/components/NumericCell';
import { Panel } from '@/ui/components/Panel';
import { ProvenanceView } from '@/ui/components/ProvenanceView';
import { ReviseEnquiry } from '@/ui/components/ReviseEnquiry';
import { SettleLine, type Nearest } from '@/ui/components/SettleLine';
import { StatusDot, TierLegend } from '@/ui/components/StatusDot';
import { TeachTerm } from '@/ui/components/TeachTerm';
import { statusTier } from '@/ui/components/tier';
import {
  approveJob,
  decideLine,
  describeJob,
  reviseJob,
  teachTerm,
  undecideLine,
} from '../actions';
import { buildJob } from '../build';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ reference: string }>;
}) {
  const { reference } = await params;
  return { title: `${reference} — Cable Quoting` };
}

/**
 * Review — the workhorse.
 *
 * One row per line of the enquiry, sorted red first because that is where the
 * engineer's time goes. Every row that the app could not settle carries the
 * control to settle it, inline: the question and the answer live in the same
 * place, so nobody has to leave the screen to unblock a job.
 */
export default async function JobPage({
  params,
}: {
  params: Promise<{ reference: string }>;
}) {
  const actor = await session.currentActor();
  if (actor === null) redirect('/sign-in');

  const { reference } = await params;
  const persisted = await jobStore.byReference(reference);
  if (persisted === undefined) notFound();

  const { job } = await buildJob(persisted);

  const lines = [...job.lines].sort(byReviewOrder);
  const priced = job.lines.filter(isPriced);
  const total = pricedValueOf(job.lines);
  const settled = persisted.status === 'review';

  return (
    <div className="flex flex-col gap-6">
      <header>
        <a href="/" style={{ color: 'var(--color-ink-tertiary)', fontSize: 'var(--text-micro)' }}>
          ← Inbox
        </a>
        <a
          href="/history"
          style={{
            marginLeft: 16,
            color: 'var(--color-copper)',
            fontSize: 'var(--text-micro)',
          }}
        >
          History →
        </a>
        <div className="mt-2 flex items-baseline gap-4">
          <h1
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 'var(--text-display-lg)',
              lineHeight: 'var(--text-display-lg--line-height)',
              letterSpacing: 'var(--text-display-lg--letter-spacing)',
              fontWeight: 500,
            }}
          >
            {persisted.customer ?? 'Unnamed enquiry'}
          </h1>
          <span className="numeric" style={{ color: 'var(--color-ink-tertiary)' }}>
            {persisted.reference}
          </span>
          {persisted.quoteNumber !== null && persisted.status !== 'review' ? (
            <a
              href={`/quotes/${persisted.quoteNumber}`}
              className="numeric"
              style={{ color: 'var(--color-copper)' }}
            >
              → {persisted.quoteNumber}
            </a>
          ) : persisted.quoteNumber !== null ? (
            /*
              Reopened to correct a quote already sent. Showing the quote
              number alone made this look like a finished job; it is the
              opposite — the most consequential state the screen has, because
              approving it sends the customer a second document.
            */
            <span style={{ color: 'var(--color-status-review)', fontSize: 'var(--text-micro)' }}>
              Correcting{' '}
              <a href={`/quotes/${persisted.quoteNumber}`} className="numeric" style={{ color: 'inherit' }}>
                {persisted.quoteNumber}
              </a>
            </span>
          ) : (
            <span style={{ color: 'var(--color-ink-tertiary)', fontSize: 'var(--text-micro)' }}>
              {statusLabel(persisted.status)}
            </span>
          )}
        </div>
        <p className="mt-2" style={{ color: 'var(--color-ink-secondary)', maxWidth: 660 }}>
          Green to spot-check, amber to check properly, red to answer. Every red
          line carries the question the app could not settle, and the box to
          settle it.
        </p>
      </header>

      <div className="flex gap-6">
        <div className="min-w-0 flex-1 flex flex-col gap-6">
          {job.unknownTerms.length > 0 ? (
            <Panel title="Words the app does not know">
              <p style={noteStyle}>
                {job.unknownTerms.length === 1
                  ? 'One phrase in this enquiry is not in the dictionary, so the line containing it paused rather than being guessed at.'
                  : `${job.unknownTerms.length} phrases in this enquiry are not in the dictionary, so the lines containing them paused rather than being guessed at.`}{' '}
                Teaching the app once resolves{' '}
                {job.unknownTerms.length === 1 ? 'it' : 'them'} here and in every
                job afterwards.
              </p>
              <div className="mt-3 flex flex-col gap-3">
                {job.unknownTerms.map((phrase) => (
                  <TeachTerm
                    key={phrase}
                    action={teachTerm}
                    phrase={phrase}
                    reference={reference}
                    canTeach={can(actor, 'rate.edit')}
                  />
                ))}
              </div>
            </Panel>
          ) : null}

          {persisted.sourceNotes.length > 0 ? (
            <Panel
              title="What the reader made of the file"
              aside={
                <span
                  className="numeric"
                  style={{
                    color: 'var(--color-ink-tertiary)',
                    fontSize: 'var(--text-micro)',
                  }}
                >
                  {persisted.sourceName}
                </span>
              }
            >
              {/*
                Including — especially — the rows it left out. A line that
                vanishes from a customer's enquiry with nobody told is the
                exact failure this app exists to prevent, so the reader's own
                account of what it skipped stays with the job rather than
                flashing past once at upload.
              */}
              <ul className="flex flex-col gap-1">
                {persisted.sourceNotes.map((note) => (
                  <li key={note} style={noteStyle}>
                    {note}
                  </li>
                ))}
              </ul>
              <p className="mt-3" style={{ ...noteStyle, color: 'var(--color-ink-tertiary)' }}>
                Anything missing can be added below with “Correct the text” —
                the lines are re-read and re-priced on save.
              </p>
            </Panel>
          ) : null}

          {persisted.document === null ? null : (
            <Panel title="Where each line came from" flush>
              {/*
                Phase 3's acceptance criterion, and the reason the document is
                stored at all: an engineer checking a quantity should never
                have to go back to the attachment. The reader's own account of
                what it skipped is above; this is the same claim made line by
                line, against the file itself.
              */}
              <ProvenanceView
                document={persisted.document.text.split('\n')}
                sourceName={persisted.sourceName}
                entries={job.lines.map((line) => {
                  const source = persisted.document?.sources[line.index];
                  return {
                    index: line.index,
                    text: line.extracted.raw,
                    where: source?.where ?? '',
                    line: source?.line ?? null,
                  };
                })}
              />
            </Panel>
          )}

          <Panel
            title="Enquiry as received"
            flush
            aside={
              persisted.source === 'paste' ? null : (
                <span
                  style={{
                    color: 'var(--color-ink-tertiary)',
                    fontSize: 'var(--text-micro)',
                  }}
                >
                  read from {persisted.sourceName}
                </span>
              )
            }
          >
            <ReviseEnquiry
              action={reviseJob}
              reference={reference}
              rawText={persisted.rawText}
              decisionCount={persisted.decisions.length}
              canRevise={settled && can(actor, 'line.override')}
            />
          </Panel>

          <Panel
            title="Lines"
            flush
            aside={
              <span
                className="numeric"
                style={{ color: 'var(--color-ink-tertiary)', fontSize: 'var(--text-micro)' }}
              >
                {job.lines.length} lines · red first
              </span>
            }
          >
            <div
              className="label flex items-center gap-3"
              style={{ padding: '6px 12px', borderBottom: '1px solid var(--color-line-strong)' }}
            >
              <span style={{ width: 8 }} />
              <span style={{ width: 108 }}>Status</span>
              <span className="flex-1">Line</span>
              <span style={{ width: 110, textAlign: 'right' }}>Quantity</span>
              <span style={{ width: 100, textAlign: 'right' }}>Unit rate</span>
              <span style={{ width: 120, textAlign: 'right' }}>Total</span>
            </div>

            {lines.map((line) => (
              <ExpandableRow
                key={line.index}
                summary={
                  <span className="flex items-center gap-3">
                    <span style={{ width: 108 }}>
                      <StatusDot tier={statusTier(line.status)} />
                    </span>
                    <span className="min-w-0 flex-1 truncate">{line.extracted.raw}</span>
                    <span style={{ width: 110, textAlign: 'right' }}>
                      <NumericCell
                        value={line.extracted.quantityMetres.value}
                        decimals={0}
                        unit="m"
                      />
                    </span>
                    <span style={{ width: 100, textAlign: 'right' }}>
                      <NumericCell
                        value={isPriced(line) ? line.unitRate : null}
                        kind="unitRate"
                      />
                    </span>
                    <span style={{ width: 120, textAlign: 'right' }}>
                      <NumericCell
                        value={isPriced(line) ? line.lineTotal : null}
                        kind="total"
                        weight="strong"
                      />
                    </span>
                  </span>
                }
              >
                <LineDetail
                  line={line}
                  reference={reference}
                  settled={settled}
                  canDecide={can(actor, 'line.override')}
                />
              </ExpandableRow>
            ))}
          </Panel>
        </div>

        <aside style={{ width: 320 }} className="shrink-0 flex flex-col gap-6">
          <Panel title="This job">
            <div className="flex flex-col gap-4">
              {(
                [
                  'exact',
                  'close',
                  'chosen',
                  'hand-priced',
                  'partial',
                  'no-match',
                ] as const
              )
                .filter((k) => job.counts[k] > 0)
                .map((k) => (
                  <div key={k} className="flex items-baseline justify-between">
                    <StatusDot tier={statusTier(k)} />
                    <span className="numeric">{job.counts[k]}</span>
                  </div>
                ))}

              <div style={{ borderTop: '1px solid var(--color-line-strong)', paddingTop: 12 }}>
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

            {settled ? (
              <ApproveJob
                action={approveJob}
                describeAction={describeJob}
                reference={reference}
                blockers={job.blockers}
                lineCount={priced.length}
                handPriced={job.counts['hand-priced']}
                customer={persisted.customer}
                terms={persisted.terms}
                canApprove={can(actor, 'quote.approve')}
              />
            ) : (
              <p className="mt-4" style={noteStyle}>
                {persisted.quoteNumber === null
                  ? 'This enquiry was closed without quoting.'
                  : `Quoted as ${persisted.quoteNumber} on ${formatInstant(persisted.updatedAt)}. Its decisions are the record of what was quoted, so they no longer change.`}
              </p>
            )}
          </Panel>

          <Panel title="Match tiers">
            <TierLegend />
          </Panel>
        </aside>
      </div>
    </div>
  );
}

function LineDetail({
  line,
  reference,
  settled,
  canDecide,
}: {
  readonly line: ReviewLine;
  readonly reference: string;
  readonly settled: boolean;
  readonly canDecide: boolean;
}) {
  /**
   * The products this line could be priced as.
   *
   * A matched line offers the product it matched, so "override the price"
   * and "price it as something else" are both reachable without leaving the
   * row. An unmatched line offers whatever the matcher found nearby. A line
   * outside the library entirely offers nothing, and the form says so rather
   * than presenting an empty dropdown.
   */
  const asNearest = (c: {
    product: { id: string; sourceSheet?: string | undefined; designation: string };
    differences: readonly {
      axis: Parameters<typeof axisLabel>[0];
      held: string;
      requested: string;
    }[];
    sameBuild?: boolean;
  }): Nearest => ({
    code: c.product.id,
    sourceSheet: c.product.sourceSheet ?? '',
    designation: c.product.designation,
    differs: c.differences.map((d) => axisLabel(d.axis)).join(', '),
    /*
      What the library *holds* on the axes that differ — not just which axes.
      Choosing between five 3C×50 codes, the engineer is choosing a voltage;
      naming the axis ("differs on voltage") makes them read to the end of a
      long designation to find out which. Naming the value puts it first.
    */
    holds: c.differences
      .map((d) =>
        d.held === ''
          ? `no ${axisLabel(d.axis)}`
          : // A bare "70" beside a cable code reads as anything; the unit is
            // what makes it a size.
            d.axis === 'sizeMm2'
            ? `${d.held} mm²`
            : d.axis === 'cores'
              ? `${d.held} core`
              : d.held,
      )
      .join(' · '),
    sameBuild: c.sameBuild ?? true,
  });

  /*
    Partial *and* No-match both carry candidates now. A No-match line used to
    end the conversation, leaving a red row with nothing to do about it — while
    the library often holds the same core count and size under a different
    designation, which is exactly what an engineer needs to see.

    A settled line keeps the whole list rather than only the code it was
    settled as, so changing your mind between five 3C×50 item codes is one
    step. Offering just the current choice meant reopening the line first,
    which threw the reason away to get the list back.
  */
  const offered = 'nearest' in line.match ? line.match.nearest.map(asNearest) : [];
  const chosenNow = hasBreakdown(line)
    ? asNearest({ product: line.product, differences: line.differences })
    : null;

  const nearest: readonly Nearest[] =
    chosenNow === null
      ? offered
      : [
          chosenNow,
          ...offered.filter(
            (n) => !(n.code === chosenNow.code && n.sourceSheet === chosenNow.sourceSheet),
          ),
        ];

  const current =
    'override' in line && line.override !== null
      ? {
          rate: line.override.unitRate.toString(),
          productCode: 'choice' in line ? (line.choice?.productCode ?? null) : null,
          reason: line.override.reason,
          by: line.override.by,
        }
      : 'choice' in line && line.choice !== null
        ? {
            rate: null,
            productCode: line.choice.productCode,
            reason: line.choice.reason,
            by: line.choice.by,
          }
        : null;

  return (
    <div>
      {hasBreakdown(line) ? (
        <>
          <div style={{ ...noteStyle, paddingBottom: 4 }}>
            {line.status === 'chosen' ? 'Priced as ' : 'Matched to '}
            <span className="numeric">{line.product.id}</span> — {line.product.designation}
          </div>

          {line.status === 'chosen' && line.differences.length > 0 ? (
            <Note tone="review">
              Differs from the enquiry on{' '}
              {line.differences.map((d) => axisLabel(d.axis)).join(', ')}.{' '}
              {line.choice?.reason}
            </Note>
          ) : null}

          {line.status === 'close' && line.match.tier === 'close' ? (
            <Note tone="review">
              {line.match.difference.requested} ← {line.match.difference.held}{' '}
              {axisLabel(line.match.difference.axis)}. {line.match.substitution.rationale}
            </Note>
          ) : null}

          {line.override !== null ? (
            <Note tone="review">
              Rate set by hand to {line.override.unitRate.toString()} OMR/m by{' '}
              {line.override.by} — {line.override.reason}. The build-up below is
              still the engine&rsquo;s costing, so the gap between cost and
              price stays visible.
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
        </>
      ) : line.status === 'hand-priced' ? (
        <>
          <Note tone="review">
            Priced by hand at {line.override.unitRate.toString()} OMR/m by{' '}
            {line.override.by} — {line.override.reason}
          </Note>
          <Note tone="quiet">
            There is no cost build-up for this line, and none is invented. The
            app originally said: {reasonOf(line)}
          </Note>
        </>
      ) : (
        <>
          <Note tone="manual">{reasonOf(line)}</Note>
          <Note tone="quiet">
            Not priced. The app refuses rather than guessing — twenty minutes of
            an engineer costs less than the margin on the order.
          </Note>
        </>
      )}

      {settled ? (
        <SettleLine
          action={decideLine}
          undoAction={undecideLine}
          reference={reference}
          position={line.index}
          nearest={nearest}
          matched={hasBreakdown(line)}
          current={current}
          canDecide={canDecide}
        />
      ) : null}
    </div>
  );
}

function reasonOf(line: ReviewLine): string {
  return 'reason' in line.match ? line.match.reason : '';
}

const noteStyle: React.CSSProperties = {
  color: 'var(--color-ink-secondary)',
  fontSize: 'var(--text-micro)',
  lineHeight: 'var(--text-micro--line-height)',
  maxWidth: 660,
};

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
    <p className="mt-2" style={{ ...noteStyle, color }}>
      {children}
    </p>
  );
}
