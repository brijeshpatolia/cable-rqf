import { dec } from '@/core/decimal';
import { formatInstant, formatNumber } from '@/core/format';
import { metres } from '@/core/units';
import { now } from '@/infra/clock';
import { session } from '@/infra/auth/session';
import { SOURCE_TERMS } from '@/infra/data';
import {
  jobStore,
  repositories,
  substitutionStore,
  vocabularyStore,
} from '@/infra/repositories';
import { computeCost } from '@/modules/costing';
import { deriveBounds, reviewJob, worstStatus, type LineStatus } from '@/modules/matching';
import { sweep } from '@/modules/pricewatch';
import { JobsTable, type JobRowView } from '@/ui/components/JobsTable';
import { NumericCell } from '@/ui/components/NumericCell';
import { NewJob } from '@/ui/components/NewJob';
import { Panel } from '@/ui/components/Panel';
import { StatusDot, TierLegend } from '@/ui/components/StatusDot';
import { openJob, openJobFromFile } from './jobs/actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Inbox — Cable Quoting' };

/** How far back the Match column re-reviews. A year of enquiries. */
const WINDOW_DAYS = 365;

/**
 * The Inbox.
 *
 * Every enquiry the app has been given, and the means to add another — pasted,
 * or read out of the customer's own spreadsheet or PDF. Intake sits at the top
 * of the first screen rather than behind a button, because it is the thing an
 * engineer does most.
 */
export default async function InboxPage() {
  const actor = await session.currentActor();
  if (actor === null) return null;

  const asOf = now();
  const since = new Date(asOf.getTime() - WINDOW_DAYS * 86_400_000);

  const [summaries, full, open, rateSet, library, dictionary, substitutions] =
    await Promise.all([
      jobStore.list(),
      jobStore.allSince(since),
      repositories.quotes.open(),
      repositories.rates.resolveAt(asOf),
      repositories.products.list(),
      vocabularyStore.dictionary(),
      substitutionStore.inForce(),
    ]);

  /*
    Two reads of the same table, and they answer different questions.

    `list()` carries the counts and the frozen quote total — the number the
    customer was actually told, which must never be recomputed here because it
    would then move with copper between one refresh and the next.

    `allSince()` carries the enquiry text and the decisions on it, which is
    what the Match column needs. Its projection deliberately omits the source
    document, so this is the cheap read even though it returns whole jobs.
  */
  const text = new Map(full.map((j) => [j.reference, j]));

  /*
    The library, the rates and the plausibility bounds are resolved once and
    reused across every enquiry. The alternative — a resolution per job — is
    what the `quotedValue` note on `JobSummary` warns against. Reviewing is
    parsing and comparison against 99 products; costing is the whole engine,
    and this screen does not cost anything.
  */
  const lmeLinked = new Set(
    [...rateSet.materials].filter(([, m]) => m.lmeLinked).map(([code]) => code),
  );
  const bounds = deriveBounds(library, lmeLinked, (p) => {
    const r = computeCost(p, { metres: metres(1000) }, rateSet, SOURCE_TERMS);
    return r.ok ? r.value.unitRate : null;
  });

  const drift = sweep(open, rateSet.copper.lme, asOf);

  const rows: readonly JobRowView[] = summaries.map((j) => {
    const source = text.get(j.reference);
    const worst =
      source === undefined
        ? undefined
        : worstStatus(
            reviewJob(source.rawText, library, rateSet, SOURCE_TERMS, bounds, {
              decisions: source.decisions,
              substitutions,
              dictionary,
            }).lines,
          );

    return {
      reference: j.reference,
      href: `/jobs/${j.reference}`,
      customer: j.customer,
      status: j.status,
      ageDays: Math.floor((asOf.getTime() - j.createdAt.getTime()) / 86_400_000),
      cells: [
        <span
          key="r"
          className="numeric"
          style={{ ...leftNumeric, color: 'var(--color-ink-bright)' }}
        >
          {j.reference}
        </span>,

        j.customer ?? (
          <span key="c" style={{ color: 'var(--color-ink-tertiary)' }}>
            not named yet
          </span>
        ),

        /*
          The Match column, which replaces a Status column that mixed three
          unrelated things: workflow state, a quote number, and a correction
          warning. Workflow state is carried by the segmented filter and the
          Quoted column; what is left — and what actually tells an engineer
          whether this enquiry needs them — is the worst line on it.

          Re-reviewed against today's library, not frozen at intake. A word the
          Rate Owner teaches turns a Partial into an Exact, and an inbox that
          still said Partial would be reporting history as if it were state.
        */
        worst === undefined ? (
          <span
            key="m"
            style={{ color: 'var(--color-ink-disabled)' }}
            title="Outside the window this screen re-reviews"
          >
            —
          </span>
        ) : (
          <span key="m" style={{ fontSize: 'var(--text-body-sm)' }}>
            <StatusDot tier={worst as LineStatus} />
          </span>
        ),

        <span key="l" className="numeric">
          {j.lineCount}
        </span>,

        <span
          key="d"
          className="numeric"
          style={{
            color:
              j.decisionCount > 0
                ? 'var(--color-status-review)'
                : 'var(--color-ink-disabled)',
          }}
          title="Lines a person answered rather than the app"
        >
          {j.decisionCount === 0 ? '—' : j.decisionCount}
        </span>,

        /*
          Two lines, and the second is why this is a column rather than a bare
          number: an enquiry reopened to correct a quote must not render like a
          finished one. Three states, not two.
        */
        <span key="v" className="flex flex-col items-end" style={{ gap: 1 }}>
          <NumericCell
            value={j.quotedValue === null ? null : dec(j.quotedValue)}
            kind="total"
          />
          {j.quoteNumber === null ? null : j.status === 'review' ? (
            <span
              className="numeric"
              style={{
                fontSize: 'var(--text-mono-nano)',
                color: 'var(--color-status-review)',
              }}
              title={`Reopened to correct ${j.quoteNumber}. Approving sends a second document.`}
            >
              correcting {j.quoteNumber}
            </span>
          ) : (
            <span
              className="numeric"
              style={{
                fontSize: 'var(--text-mono-nano)',
                // A quote number is read and repeated back to a customer, so
                // it does not get the faint ink (2.27:1 on this surface).
                color: 'var(--color-ink-tertiary)',
              }}
            >
              {j.quoteNumber}
            </span>
          )}
        </span>,

        <span
          key="t"
          className="numeric"
          style={{
            ...leftNumeric,
            color: 'var(--color-ink-tertiary)',
            fontSize: 11,
            whiteSpace: 'nowrap',
          }}
        >
          {formatInstant(j.createdAt)}
        </span>,
      ],
    };
  });

  const waiting = summaries.filter((j) => j.status === 'review').length;

  /*
    Of the enquiries that arrived this month, how many now carry a quote.

    Not "quotes issued this month", which is what the label used to say and
    what `JobSummary` cannot answer: it exposes `createdAt` for the enquiry and
    `quoteNumber` for its quote, but no instant at which the quoting happened.
    A June enquiry quoted in July would have been missed and a July enquiry
    quoted in August counted, so the label named a measure the data does not
    carry. Stating the measure the data does carry is both honest and more
    useful on an inbox — it is a conversion rate on this month's intake.
  */
  const monthStart = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), 1));
  const thisMonth = summaries.filter((j) => j.createdAt >= monthStart);
  const quotedOfIntake = thisMonth.filter((j) => j.quoteNumber !== null).length;

  return (
    <>
      <header className="flex flex-wrap items-end justify-between" style={{ gap: 32 }}>
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
            Inbox
          </h1>
          <p
            className="mt-2"
            style={{
              color: 'var(--color-ink-secondary)',
              maxWidth: 620,
              textWrap: 'pretty',
            }}
          >
            Enquiries under review. Each keeps the customer&rsquo;s text as it
            arrived and remembers what you decided — so a job left open across a
            copper move reprices rather than going stale.
          </p>
        </div>

        <div className="flex flex-wrap" style={{ gap: 32 }}>
          <Metric label="Waiting on you" value={String(waiting)} unit="enquiries" />
          <Metric
            label="Quoted, this month’s intake"
            value={`${quotedOfIntake}/${thisMonth.length}`}
            unit="enquiries"
            title={
              `${quotedOfIntake} of the ${thisMonth.length} ${
                thisMonth.length === 1 ? 'enquiry' : 'enquiries'
              } received since ${monthStart.toISOString().slice(0, 10)} now carry a quote.`
            }
          />
          {/*
            Exposure is a delta, which is the one place a negative is red. It
            comes from the same sweep that drives the Price Watch and is never
            recomputed here — two screens computing one number is how they come
            to disagree about it.
          */}
          <Metric
            label="Copper exposure"
            value={formatNumber(drift.totalExposure, 2)}
            unit="OMR"
            negative={drift.totalExposure.lessThan(0)}
          />
        </div>
      </header>

      <Panel
        title="New enquiry"
        note="Paste the customer’s text, or hand over their file"
        scale="shell"
        flush
      >
        <NewJob action={openJob} uploadAction={openJobFromFile} />
      </Panel>

      <Panel title="Enquiries" scale="shell" flush>
        <JobsTable
          columns={[
            { header: 'Job', width: 132 },
            { header: 'Customer' },
            { header: 'Match', width: 168 },
            { header: 'Lines', width: 76, align: 'right' },
            { header: 'By hand', width: 90, align: 'right' },
            { header: 'Quoted', width: 148, align: 'right' },
            { header: 'Received', width: 176 },
          ]}
          rows={rows}
        />
        {/*
          The legend belongs to the panel, not to the table.

          It used to be threaded through `JobsTable` into a `footer` prop on
          `DataTable`, which put a second child beside `<table>` and produced a
          missing-key warning in development. Rendering it here removes the
          prop from two components and says the right thing about ownership: a
          table renders rows, and what the dots mean is the panel's business.
        */}
        <div
          className="panel-inset"
          style={{
            padding: '12px var(--cell-pad-x-shell)',
            borderTop: '1px solid var(--color-line-panel)',
          }}
        >
          <TierLegend short />
        </div>
      </Panel>
    </>
  );
}

/** A figure in the header rail: label above, number and unit below. */
function Metric({
  label,
  value,
  unit,
  negative = false,
  title,
}: {
  readonly label: string;
  readonly value: string;
  readonly unit: string;
  readonly negative?: boolean;
  /** Spells out the measure where the label alone would be ambiguous. */
  readonly title?: string;
}) {
  return (
    <div className="flex flex-col" style={{ gap: 6 }} title={title}>
      <span className="label">{label}</span>
      <span className="flex items-baseline" style={{ gap: 6 }}>
        <span
          className="numeric"
          style={{
            fontSize: 'var(--text-numeric-lg)',
            lineHeight: 'var(--text-numeric-lg--line-height)',
            letterSpacing: 'var(--text-numeric-lg--letter-spacing)',
            color: negative ? 'var(--color-status-manual)' : 'var(--color-ink-primary)',
          }}
        >
          {value}
        </span>
        <span
          className="numeric"
          style={{
            fontSize: 'var(--text-mono-micro)',
            color: 'var(--color-ink-tertiary)',
          }}
        >
          {unit}
        </span>
      </span>
    </div>
  );
}

const leftNumeric: React.CSSProperties = { textAlign: 'left', display: 'block' };
