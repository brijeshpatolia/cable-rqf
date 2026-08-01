import { redirect } from 'next/navigation';
import { metres } from '@/core/units';
import { formatNumber } from '@/core/format';
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
import {
  SUGGESTED,
  coverageOf,
  gapsOf,
  type CountedLine,
  type GapLine,
  type Share,
} from '@/modules/coverage';
import { deriveBounds, reviewJob, type LineStatus } from '@/modules/matching';
import { GapTable } from '@/ui/components/GapTable';
import { Panel } from '@/ui/components/Panel';
import { StatusDot } from '@/ui/components/StatusDot';
import { statusTier } from '@/ui/components/tier';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Coverage — Cable Quoting' };

/** A quarter, which is the window the plan's gate is written against. */
const DAYS = 90;

/**
 * Coverage — does the library cover what customers ask for?
 *
 * PROJECT_PLAN.md gates Phase 4 on one number, and says the app tracks it
 * *"precisely so this call can be made on evidence"*. It did not: tier counts
 * were computed per job on render and discarded, so a six-week decision had
 * nothing behind it but impressions. This is the evidence.
 *
 * **Every line is re-reviewed against today's library, today's dictionary and
 * today's rates.** That is a choice, and the screen says so, because it is the
 * difference between two questions that look alike:
 *
 *   - *What did the app do with these enquiries at the time?* Historical, and
 *     already answered per job by the quote each one froze.
 *   - *What would the app do with them now?* Which is the question Phase 4
 *     actually asks — whether to build a construction model **going forward**,
 *     given the library as it now stands.
 *
 * The second is the useful one, and it moves: a word the Rate Owner teaches
 * turns Partial lines into Exact ones, and coverage improves without anyone
 * writing a line of costing code. That is the point.
 */
export default async function CoveragePage() {
  const actor = await session.currentActor();
  if (actor === null) redirect('/sign-in');

  const asOf = now();
  const since = new Date(asOf.getTime() - DAYS * 24 * 60 * 60 * 1000);

  const [jobs, rateSet, library, dictionary, substitutions] = await Promise.all([
    jobStore.allSince(since),
    repositories.rates.resolveAt(asOf),
    repositories.products.list(),
    vocabularyStore.dictionary(),
    substitutionStore.inForce(),
  ]);

  // Loaded once and reused across every job. The alternative — a full rate
  // resolution per job — turns an occasional page into an expensive one.
  const lmeLinked = new Set(
    [...rateSet.materials].filter(([, m]) => m.lmeLinked).map(([code]) => code),
  );
  const bounds = deriveBounds(library, lmeLinked, (p) => {
    const r = computeCost(p, { metres: metres(1000) }, rateSet, SOURCE_TERMS);
    return r.ok ? r.value.unitRate : null;
  });

  const counted: CountedLine[] = [];
  const uncovered: GapLine[] = [];
  for (const job of jobs) {
    const reviewed = reviewJob(job.rawText, library, rateSet, SOURCE_TERMS, bounds, {
      decisions: job.decisions,
      substitutions,
      dictionary,
    });
    for (const line of reviewed.lines) {
      counted.push({
        status: line.status,
        // From the enquiry, not from pricing — which is the point: an
        // unpriceable line still tells us how much of it was asked for.
        metres: line.extracted.quantityMetres.value,
      });
      /*
        The same lines again, carrying what they were asked for rather than
        only their tier. `gapsOf` filters to the uncovered ones itself, so the
        two measures cannot come to disagree about which tiers those are.
      */
      uncovered.push({
        status: line.status,
        extracted: line.extracted,
        customer: job.customer,
      });
    }
  }

  const coverage = coverageOf(counted, SUGGESTED);
  const gaps = gapsOf(uncovered);

  const ORDER: readonly LineStatus[] = [
    'exact',
    'close',
    'chosen',
    'hand-priced',
    'partial',
    'no-match',
  ];

  return (
    <div className="flex flex-col gap-6">
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
          Coverage
        </h1>
        <p className="mt-2" style={{ color: 'var(--color-ink-secondary)', maxWidth: 680 }}>
          How much of what customers asked for over the last {DAYS} days the
          library can price on its own — {jobs.length}{' '}
          {jobs.length === 1 ? 'enquiry' : 'enquiries'}, {counted.length}{' '}
          {counted.length === 1 ? 'line' : 'lines'}.
        </p>
        <p className="mt-2" style={note}>
          Every line is re-read against the library, the dictionary and the
          rates as they stand today — not as they stood when the enquiry
          arrived. That is deliberate: the question is what the app would do
          with this demand now, and teaching the dictionary a word improves
          coverage without a line of costing code being written.
        </p>
      </header>

      <Panel title="Lines the library could not price">
        <div className="flex flex-wrap items-baseline gap-x-12 gap-y-5">
          <Metric
            label={`By line count · threshold ${SUGGESTED.volumePercent}%`}
            share={coverage.byVolume}
            unit="lines"
          />
          <Metric
            label={`By length asked for · threshold ${SUGGESTED.quantityPercent}%`}
            share={coverage.byQuantity}
            unit="metres"
          />
        </div>

        <p className="mt-5" style={note}>
          <strong style={{ color: 'var(--color-ink-primary)', fontWeight: 550 }}>
            {coverage.byVolume.percent === null
              ? 'No enquiries in the window, so there is nothing to decide on.'
              : coverage.justified
                ? 'Past a threshold. On this evidence, costing outside the library is worth discussing.'
                : 'Inside both thresholds. On this evidence, the library covers the demand.'}
          </strong>{' '}
          The thresholds above are the plan&rsquo;s suggestion, not a rule —
          you set the real ones. The app measures; it does not decide.
        </p>
        <p className="mt-2" style={note}>
          &ldquo;Could not price&rdquo; means Partial and No-match. A line an
          engineer priced by hand is not counted against the library: a
          construction model would have had to guess at that one too, and
          folding it in would inflate the case for building one.
        </p>
        <p className="mt-2" style={note}>
          The plan words the second threshold as a share of <em>quoted value</em>.
          Taken literally it can never fire: a line nothing could price
          contributes nothing to quoted value, so the share would read 0.0% for
          ever while looking like evidence. Valuing those lines from their
          nearest match would fix the arithmetic and break the rule the app is
          built on — so this measures the length the customer actually asked
          for, which is stated in the enquiry rather than derived from
          anything. It does the job the threshold was for: it separates one
          12,000 m line nobody can price from a dozen 50 m ones.
        </p>
      </Panel>

      <Panel
        title="What is missing"
        note="The same lines, named and ranked — longest first"
        flush
      >
        {/*
          Two failures arrive here wearing the same tier and have opposite
          remedies, so the split is stated before the table rather than left
          to be counted off it. A percentage says there is a problem; this
          says which problem, and a team that reads only the percentage can
          spend a quarter on the wrong one.
        */}
        <div
          className="flex flex-wrap gap-x-10 gap-y-3"
          style={{ padding: '14px var(--cell-pad-x)', borderBottom: '1px solid var(--color-line-panel)' }}
        >
          <Split
            value={gaps.notInLibrary}
            label="Not in the library"
            hint="Read correctly, and there is no such product. Widening the range is what fixes these."
          />
          <Split
            value={gaps.unreadable}
            label="Could not read"
            hint="The cores or the size could not be made out, so nothing could match however wide the range. A better reader is what fixes these."
          />
        </div>

        <GapTable gaps={gaps} />
      </Panel>

      <Panel title="Where the lines fell">
        <div className="flex flex-col gap-3" style={{ maxWidth: 520 }}>
          {ORDER.map((status) => {
            const n = coverage.counts[status];
            const width =
              counted.length === 0 ? 0 : Math.round((n / counted.length) * 100);
            return (
              <div key={status} className="flex items-center gap-4">
                <span style={{ width: 150 }}>
                  <StatusDot tier={statusTier(status)} />
                </span>
                <span
                  aria-hidden
                  style={{
                    flex: 1,
                    height: 6,
                    borderRadius: 3,
                    backgroundColor: 'var(--color-surface-raised)',
                  }}
                >
                  {/* One bar, one colour. The status is already named and
                      dotted beside it; colouring the bar too would say the
                      same thing twice and make six colours out of three. */}
                  <span
                    style={{
                      display: 'block',
                      width: `${width}%`,
                      height: '100%',
                      borderRadius: 3,
                      backgroundColor: 'var(--color-copper)',
                    }}
                  />
                </span>
                <span className="numeric" style={{ width: 56, textAlign: 'right' }}>
                  {n}
                </span>
                <span
                  className="numeric"
                  style={{
                    width: 56,
                    textAlign: 'right',
                    color: 'var(--color-ink-tertiary)',
                    fontSize: 'var(--text-micro)',
                  }}
                >
                  {counted.length === 0 ? '—' : `${width}%`}
                </span>
              </div>
            );
          })}
        </div>
      </Panel>
    </div>
  );
}

function Metric({
  label,
  share,
  unit,
}: {
  readonly label: string;
  readonly share: Share;
  readonly unit: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="label">{label}</span>
      <span
        className="numeric"
        style={{
          fontSize: 'var(--text-display-sm)',
          // Amber has always meant *look at this properly*, which is exactly
          // what being past the threshold asks for. It is not a failure.
          color: share.past ? 'var(--color-status-review)' : 'var(--color-ink-primary)',
          textAlign: 'left',
          display: 'block',
        }}
      >
        {share.percent === null ? '—' : `${formatNumber(share.percent, 1)}%`}
      </span>
      <span className="numeric" style={{ ...note, textAlign: 'left', display: 'block' }}>
        {share.uncovered.toLocaleString('en-GB')} of{' '}
        {share.total.toLocaleString('en-GB')} {unit}
      </span>
    </div>
  );
}

const note: React.CSSProperties = {
  color: 'var(--color-ink-secondary)',
  fontSize: 'var(--text-micro)',
  lineHeight: 'var(--text-micro--line-height)',
  maxWidth: 680,
};

/**
 * One side of the split, above the table.
 *
 * Deliberately not a percentage. The question these answer is "which of these
 * two problems do we have", and at the counts a first quarter produces, two
 * raw numbers are read correctly where two percentages invite arithmetic
 * nobody asked for.
 */
function Split({
  value,
  label,
  hint,
}: {
  readonly value: number;
  readonly label: string;
  readonly hint: string;
}) {
  return (
    <div className="flex flex-col" style={{ gap: 4 }} title={hint}>
      <span className="label">{label}</span>
      <span className="flex items-baseline" style={{ gap: 6 }}>
        <span
          className="numeric"
          style={{
            fontSize: 'var(--text-numeric-lg)',
            lineHeight: 'var(--text-numeric-lg--line-height)',
            color: value === 0 ? 'var(--color-ink-tertiary)' : 'var(--color-ink-primary)',
          }}
        >
          {value}
        </span>
        <span
          className="numeric"
          style={{ fontSize: 'var(--text-mono-micro)', color: 'var(--color-ink-tertiary)' }}
        >
          {value === 1 ? 'line' : 'lines'}
        </span>
      </span>
    </div>
  );
}
