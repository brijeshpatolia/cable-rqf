import { formatInstant } from '@/core/format';
import { session } from '@/infra/auth/session';
import type { JobSummary } from '@/infra/db/job-repository';
import { jobStore } from '@/infra/repositories';
import { statusLabel } from '@/modules/jobs';
import { DataTable } from '@/ui/components/DataTable';
import { NewJob } from '@/ui/components/NewJob';
import { Panel } from '@/ui/components/Panel';
import { openJob } from './jobs/actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Inbox — Cable Quoting' };

/**
 * The Inbox.
 *
 * Every enquiry the app has been given, and the box to add another. Until
 * Phase 3 reads the customer's document, that box *is* the intake — so it sits
 * at the top of the first screen rather than behind a button.
 */
export default async function InboxPage() {
  const actor = await session.currentActor();
  const jobs = actor === null ? [] : await jobStore.list();
  const open = jobs.filter((j) => j.status === 'review');

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
            <NewJob action={openJob} />
          </Panel>

          <Panel
            title="Jobs"
            flush
            aside={
              <span
                className="numeric"
                style={{
                  color: 'var(--color-ink-tertiary)',
                  fontSize: 'var(--text-micro)',
                }}
              >
                {open.length} open · {jobs.length} total
              </span>
            }
          >
            <DataTable
              columns={[
                {
                  key: 'reference',
                  header: 'Job',
                  width: 120,
                  render: (j: JobSummary) => (
                    <span className="numeric" style={{ textAlign: 'left', display: 'block' }}>
                      {j.reference}
                    </span>
                  ),
                },
                {
                  key: 'customer',
                  header: 'Customer',
                  render: (j) =>
                    j.customer ?? (
                      <span style={{ color: 'var(--color-ink-tertiary)' }}>
                        not named yet
                      </span>
                    ),
                },
                {
                  key: 'lines',
                  header: 'Lines',
                  align: 'right',
                  width: 70,
                  render: (j) => <span className="numeric">{j.lineCount}</span>,
                },
                {
                  key: 'decided',
                  header: 'By hand',
                  align: 'right',
                  width: 80,
                  render: (j) => (
                    <span
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
                    </span>
                  ),
                },
                {
                  key: 'status',
                  header: 'Status',
                  width: 120,
                  render: (j) =>
                    j.quoteNumber === null ? (
                      <span
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
                      <span
                        className="numeric"
                        style={{
                          color: 'var(--color-copper)',
                          textAlign: 'left',
                          display: 'block',
                        }}
                      >
                        {j.quoteNumber}
                      </span>
                    ),
                },
                {
                  key: 'received',
                  header: 'Received',
                  width: 160,
                  render: (j) => (
                    <span
                      className="numeric"
                      style={{
                        color: 'var(--color-ink-tertiary)',
                        fontSize: 'var(--text-micro)',
                        textAlign: 'left',
                        display: 'block',
                      }}
                    >
                      {formatInstant(j.createdAt)}
                    </span>
                  ),
                },
              ]}
              rows={jobs}
              rowKey={(j) => j.id}
              href={(j) => `/jobs/${j.reference}`}
              empty="No enquiries yet. Paste one above to start."
            />
          </Panel>
        </>
      )}
    </div>
  );
}
