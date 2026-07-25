import type { PrismaClient } from '@prisma/client';
import { dec } from '@/core/decimal';
import type { Actor } from '@/modules/auth';
import type { Job, JobSource, JobStatus, PlannedDecision } from '@/modules/jobs';
import { nextJobReference } from '@/modules/jobs';
import type { LineDecision } from '@/modules/matching';
import { prisma as defaultClient } from './client';

/**
 * Job persistence.
 *
 * Only decisions are stored, never prices. A job read back is the customer's
 * text plus what humans decided about it; everything numeric is recomputed by
 * the engine at render time from the rates in force. That is what lets a job
 * left open over a weekend of copper movement reprice instead of quietly
 * becoming wrong.
 */

interface JobRow {
  readonly id: string;
  readonly reference: string;
  readonly status: JobStatus;
  readonly customer: string | null;
  readonly terms: string | null;
  readonly source: JobSource;
  readonly source_name: string | null;
  readonly source_notes: string[];
  readonly raw_text: string;
  readonly created_by: string | null;
  readonly created_at: Date;
  readonly updated_at: Date;
  readonly quote_number: string | null;
}

interface DecisionRow {
  readonly job_id: string;
  readonly position: number;
  readonly override_rate: string | null;
  readonly chosen_product_code: string | null;
  readonly chosen_source_sheet: string | null;
  readonly decision_reason: string | null;
  readonly decided_by: string | null;
  readonly decided_at: Date | null;
}

const SELECT_JOB = `
  SELECT j.id::text, j.reference, j.status::text AS status, j.customer, j.terms,
         j.source::text AS source, j.source_name, j.source_notes, j.raw_text,
         u.name AS created_by, j.created_at, j.updated_at,
         q.number AS quote_number
    FROM job j
    LEFT JOIN app_user u ON u.id = j.created_by_id
    LEFT JOIN quote q ON q.id = j.quote_id`;

const SELECT_DECISIONS = `
  SELECT l.job_id::text, l.position,
         l.override_rate::text AS override_rate,
         l.chosen_product_code, l.chosen_source_sheet,
         l.decision_reason, d.name AS decided_by, l.decided_at
    FROM job_line l LEFT JOIN app_user d ON d.id = l.decided_by_id`;

/**
 * A stored decision is only half-formed until it has a reason and an author —
 * and the database refuses to store one that hasn't. Rows that somehow lack
 * either are dropped rather than surfaced as a decision nobody made.
 */
function toDecision(r: DecisionRow): LineDecision | null {
  const reason = r.decision_reason;
  const by = r.decided_by ?? '';
  const at = r.decided_at;
  if (reason === null || at === null) return null;

  return {
    position: r.position,
    ...(r.override_rate !== null
      ? { override: { unitRate: dec(r.override_rate), reason, by, at } }
      : {}),
    ...(r.chosen_product_code !== null && r.chosen_source_sheet !== null
      ? {
          choice: {
            productCode: r.chosen_product_code,
            sourceSheet: r.chosen_source_sheet,
            reason,
            by,
            at,
          },
        }
      : {}),
  };
}

function hydrate(j: JobRow, decisions: readonly DecisionRow[]): Job {
  return {
    id: j.id,
    reference: j.reference,
    status: j.status,
    customer: j.customer,
    terms: j.terms,
    source: j.source,
    sourceName: j.source_name,
    sourceNotes: j.source_notes ?? [],
    rawText: j.raw_text,
    createdBy: j.created_by,
    createdAt: j.created_at,
    updatedAt: j.updated_at,
    quoteNumber: j.quote_number,
    decisions: decisions
      .filter((d) => d.job_id === j.id)
      .map(toDecision)
      .filter((d): d is LineDecision => d !== null)
      .sort((a, b) => a.position - b.position),
  };
}

/** A job in a list: enough to choose one, without loading every decision. */
export interface JobSummary {
  readonly id: string;
  readonly reference: string;
  readonly status: JobStatus;
  readonly customer: string | null;
  readonly source: JobSource;
  readonly sourceName: string | null;
  readonly lineCount: number;
  readonly decisionCount: number;
  readonly createdBy: string | null;
  readonly createdAt: Date;
  readonly quoteNumber: string | null;
}

interface SummaryRow extends JobRow {
  readonly line_count: number;
  readonly decision_count: bigint;
}

export class DbJobRepository {
  constructor(private readonly db: PrismaClient = defaultClient) {}

  /**
   * The inbox.
   *
   * Line count is derived from the stored text rather than a column, so it
   * cannot disagree with what the review screen will actually show. Counting
   * newlines in SQL is cheap and there is no second number to keep in step.
   */
  async list(limit = 100): Promise<readonly JobSummary[]> {
    const rows = await this.db.$queryRawUnsafe<SummaryRow[]>(
      `${SELECT_JOB.replace(
        'j.raw_text,',
        `j.raw_text,
         array_length(
           array_remove(string_to_array(btrim(j.raw_text), E'\\n'), ''), 1
         ) AS line_count,
         (SELECT count(*) FROM job_line l WHERE l.job_id = j.id) AS decision_count,`,
      )}
       ORDER BY j.created_at DESC LIMIT ${Number(limit)}`,
    );

    return rows.map((r) => ({
      id: r.id,
      reference: r.reference,
      status: r.status,
      customer: r.customer,
      source: r.source,
      sourceName: r.source_name,
      lineCount: r.line_count ?? 0,
      decisionCount: Number(r.decision_count),
      createdBy: r.created_by,
      createdAt: r.created_at,
      quoteNumber: r.quote_number,
    }));
  }

  async byReference(reference: string): Promise<Job | undefined> {
    const rows = await this.db.$queryRawUnsafe<JobRow[]>(
      `${SELECT_JOB} WHERE j.reference = $1`,
      reference,
    );
    const job = rows[0];
    if (job === undefined) return undefined;

    const decisions = await this.db.$queryRawUnsafe<DecisionRow[]>(
      `${SELECT_DECISIONS} WHERE l.job_id = $1::uuid`,
      job.id,
    );
    return hydrate(job, decisions);
  }

  /**
   * Opens a job on a block of RFQ text.
   *
   * The reference is derived inside the transaction from the count so far this
   * year, so two engineers pasting at once cannot both take J-2026-0042 — the
   * unique index refuses the second and the whole transaction is abandoned
   * rather than half-written.
   */
  async open(input: {
    readonly rawText: string;
    readonly customer?: string | null;
    readonly source?: JobSource;
    readonly sourceName?: string | null;
    readonly sourceNotes?: readonly string[];
    readonly actor: Actor;
    readonly at: Date;
  }): Promise<{ readonly reference: string }> {
    return this.db.$transaction(async (tx) => {
      const year = input.at.getUTCFullYear();
      const counted = await tx.$queryRaw<{ count: bigint }[]>`
        SELECT count(*) FROM job WHERE reference LIKE ${`J-${year}-%`}`;

      const reference = nextJobReference(year, Number(counted[0]?.count ?? 0));

      await tx.job.create({
        data: {
          reference,
          rawText: input.rawText,
          customer: input.customer ?? null,
          source: input.source ?? 'paste',
          sourceName: input.sourceName ?? null,
          sourceNotes: [...(input.sourceNotes ?? [])],
          createdById: input.actor.id,
        },
      });

      return { reference };
    });
  }

  /**
   * Replaces the enquiry text, and clears every decision on the job.
   *
   * Decisions are keyed by line position, so editing the text renumbers the
   * things they point at: insert a line at the top and "price line 4 by hand"
   * silently becomes a decision about line 5. Clearing is the only safe answer,
   * and the screen states it before the button rather than after.
   */
  async revise(
    reference: string,
    rawText: string,
    actor: Actor,
  ): Promise<{ readonly cleared: number }> {
    return this.db.$transaction(async (tx) => {
      const job = await tx.job.findUniqueOrThrow({ where: { reference } });
      const cleared = await tx.jobLine.deleteMany({ where: { jobId: job.id } });

      await tx.job.update({ where: { reference }, data: { rawText } });

      await tx.auditEvent.create({
        data: {
          actorId: actor.id,
          actorEmail: actor.email,
          entity: `job:${reference}`,
          field: 'raw_text',
          previous: `${job.rawText.split('\n').length} lines`,
          next: `${rawText.split('\n').length} lines`,
          reason:
            cleared.count === 0
              ? 'Enquiry text corrected.'
              : `Enquiry text corrected; ${cleared.count} decision(s) cleared because line positions moved.`,
        },
      });

      return { cleared: cleared.count };
    });
  }

  /** The customer and terms an engineer types while reviewing. */
  async describe(
    reference: string,
    input: { readonly customer?: string | null; readonly terms?: string | null },
  ): Promise<void> {
    await this.db.job.update({
      where: { reference },
      data: {
        ...(input.customer !== undefined ? { customer: input.customer } : {}),
        ...(input.terms !== undefined ? { terms: input.terms } : {}),
      },
    });
  }

  /**
   * Records one human's answer to one line, and says so in the audit trail.
   *
   * Upserted on (job, position): an engineer who changes their mind replaces
   * the decision rather than accumulating two, but the audit event for the
   * first is already written and stays written.
   */
  async decide(
    jobId: string,
    plan: PlannedDecision,
    actor: Actor,
    reference: string,
  ): Promise<void> {
    const reason = plan.override?.reason ?? plan.choice?.reason ?? '';
    const at = plan.override?.at ?? plan.choice?.at ?? new Date();

    await this.db.$transaction(async (tx) => {
      const data = {
        overrideRate: plan.override?.unitRate.toString() ?? null,
        chosenProductCode: plan.choice?.productCode ?? null,
        chosenSourceSheet: plan.choice?.sourceSheet ?? null,
        decisionReason: reason,
        decidedById: actor.id,
        decidedAt: at,
      };

      await tx.jobLine.upsert({
        where: { jobId_position: { jobId, position: plan.position } },
        update: data,
        create: { jobId, position: plan.position, ...data },
      });

      await tx.auditEvent.create({
        data: {
          actorId: actor.id,
          actorEmail: actor.email,
          entity: `job:${reference}`,
          field: `line:${plan.position + 1}`,
          previous: 'unpriced',
          next: plan.summary,
          reason,
        },
      });
    });
  }

  /** Withdraws a decision, leaving the line open again. */
  async undecide(
    jobId: string,
    position: number,
    actor: Actor,
    reference: string,
  ): Promise<void> {
    await this.db.$transaction(async (tx) => {
      await tx.jobLine.deleteMany({ where: { jobId, position } });
      await tx.auditEvent.create({
        data: {
          actorId: actor.id,
          actorEmail: actor.email,
          entity: `job:${reference}`,
          field: `line:${position + 1}`,
          previous: 'decided',
          next: 'unpriced',
          reason: 'Decision withdrawn.',
        },
      });
    });
  }

  /** Marks the job quoted and ties it to the quote it became. */
  async markQuoted(jobId: string, quoteId: string): Promise<void> {
    await this.db.job.update({
      where: { id: jobId },
      data: { status: 'approved', quoteId },
    });
  }

  async abandon(reference: string, actor: Actor, reason: string): Promise<void> {
    await this.db.$transaction(async (tx) => {
      await tx.job.update({ where: { reference }, data: { status: 'abandoned' } });
      await tx.auditEvent.create({
        data: {
          actorId: actor.id,
          actorEmail: actor.email,
          entity: `job:${reference}`,
          field: 'status',
          previous: 'review',
          next: 'abandoned',
          reason,
        },
      });
    });
  }
}
