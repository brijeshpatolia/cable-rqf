import { dec } from '@/core/decimal';
import { formatInstant } from '@/core/format';
import { now } from '@/infra/clock';
import { session } from '@/infra/auth/session';
import { jobStore } from '@/infra/repositories';
import { statusLabel } from '@/modules/jobs';
import { JobsTable, type JobRowView } from '@/ui/components/JobsTable';
import { NumericCell } from '@/ui/components/NumericCell';
import { NewJob } from '@/ui/components/NewJob';
import { Panel } from '@/ui/components/Panel';
import { openJob, openJobFromFile } from './jobs/actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Inbox — Cable Quoting' };

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
  const jobs = actor === null ? [] : await jobStore.list();
  const open = jobs.filter((j) => j.status === 'review');

  /*
    Cells are rendered here and handed over already formed, so the filter chips
    are the only thing the browser is asked to do. Formatting a number or a
    date twice — once for the server pass and once for the client — is how two
    screens end up disagreeing about what 8,500 looks like.

    `ageDays` is computed here too: the client has no business owning a clock
    when the server already knows when the page was built.
  */
  const asOf = now();
  const rows: readonly JobRowView[] = jobs.map((j) => ({
    reference: j.reference,
    href: `/jobs/${j.reference}`,
    customer: j.customer,
    status: j.status,
    ageDays: Math.floor((asOf.getTime() - j.createdAt.getTime()) / 86_400_000),
    cells: [
      <span key="r" className="numeric" style={leftNumeric}>
        {j.reference}
      </span>,
      j.customer ?? (
        <span key="c" style={{ color: 'var(--color-ink-tertiary)' }}>
          not named yet
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
              : 'var(--color-ink-tertiary)',
        }}
        title="Lines a person answered rather than the app"
      >
        {j.decisionCount === 0 ? '—' : j.decisionCount}
      </span>,
      <NumericCell
        key="v"
        value={j.quotedValue === null ? null : dec(j.quotedValue)}
        kind="total"
      />,
      j.quoteNumber === null ? (
        <span
          key="s"
          style={{
            color:
              j.status === 'review'
                ? 'var(--color-ink-primary)'
                : 'var(--color-ink-tertiary)',
          }}
        >
          {statusLabel(j.status)}
        </span>
      ) : (
        <span key="s" className="numeric" style={{ ...leftNumeric, color: 'var(--color-copper)' }}>
          {j.quoteNumber}
        </span>
      ),
      <span
        key="t"
        className="numeric"
        style={{
          ...leftNumeric,
          color: 'var(--color-ink-tertiary)',
          fontSize: 'var(--text-micro)',
        }}
      >
        {formatInstant(j.createdAt)}
      </span>,
    ],
  }));

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
          Inbox
        </h1>
        <p className="mt-2" style={{ color: 'var(--color-ink-secondary)', maxWidth: 660 }}>
          Enquiries under review. Each keeps the customer&rsquo;s text exactly as
          it arrived and remembers what you decided about the lines the app
          could not settle — so a job left open across a copper move reprices
          rather than going stale.
        </p>
      </header>

      {actor === null ? (
        <Panel title="Sign in">
          <p style={{ color: 'var(--color-ink-secondary)' }}>
            <a href="/sign-in" style={{ color: 'var(--color-copper)' }}>
              Sign in
            </a>{' '}
            to see the enquiries under review.
          </p>
        </Panel>
      ) : (
        <>
          <Panel title="New enquiry" flush>
            <NewJob action={openJob} uploadAction={openJobFromFile} />
          </Panel>

          <Panel title="Enquiries" flush>
            <JobsTable
              columns={[
                { header: 'Job', width: 120 },
                { header: 'Customer' },
                { header: 'Lines', width: 70, align: 'right' },
                { header: 'By hand', width: 80, align: 'right' },
                { header: 'Quoted', width: 120, align: 'right' },
                { header: 'Status', width: 120 },
                { header: 'Received', width: 160 },
              ]}
              rows={rows}
            />
          </Panel>
        </>
      )}
    </div>
  );
}

const leftNumeric: React.CSSProperties = { textAlign: 'left', display: 'block' };
