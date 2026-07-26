import { Prisma, type PrismaClient } from '@prisma/client';
import { dec } from '@/core/decimal';
import type { Actor } from '@/modules/auth';
import type { SourceRegion } from '@/modules/extraction';
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
  readonly source_text: string | null;
  readonly line_sources: unknown;
  readonly created_by: string | null;
  readonly created_at: Date;
  readonly updated_at: Date;
  readonly quote_number: string | null;
  readonly quote_id: string | null;
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
         j.source_text, j.line_sources,
         u.name AS created_by, j.created_at, j.updated_at,
         q.number AS quote_number, q.id::text AS quote_id
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

/**
 * JSONB back into source regions, defensively.
 *
 * The column is written by this app and read by this app, but it is still a
 * `Json` column: a shape that drifts, a hand-edited row, or a migration that
 * arrives before the code that fills it would otherwise crash the job screen.
 * A malformed entry is dropped, which costs one line its provenance and loses
 * nobody their enquiry.
 */
function toSources(value: unknown): readonly SourceRegion[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) return [];
    const { line, where } = entry as Record<string, unknown>;
    if (typeof line !== 'number' || !Number.isInteger(line) || line < 0) return [];
    if (typeof where !== 'string') return [];
    return [{ line, where }];
  });
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
    document:
      j.source_text === null
        ? null
        : { text: j.source_text, sources: toSources(j.line_sources) },
    createdBy: j.created_by,
    createdAt: j.created_at,
    updatedAt: j.updated_at,
    quoteNumber: j.quote_number,
    quoteId: j.quote_id,
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
  /**
   * What the quote came to, for a job that has one.
   *
   * Null while a job is still in review, and deliberately not filled in by
   * pricing the enquiry on the fly: that number moves with copper between one
   * refresh and the next, which is right on the review screen and wrong in a
   * list column, and it would put a full costing run behind every page load.
   */
  readonly quotedValue: string | null;
}

interface SummaryRow extends JobRow {
  readonly line_count: number;
  readonly decision_count: bigint;
  readonly quoted_value: string | null;
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
         (SELECT count(*) FROM job_line l WHERE l.job_id = j.id) AS decision_count,
         (SELECT sum(ql.line_total)::text FROM quote_line ql
           WHERE ql.quote_id = j.quote_id) AS quoted_value,`,
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
      quotedValue: r.quoted_value,
    }));
  }

  /**
   * Every job, whole, for a question that has to look across all of them.
   *
   * One query for the jobs and one for every decision, rather than a
   * `byReference` per job — the coverage screen re-reviews the lot, and doing
   * that N+1 queries at a time would make an occasional page an expensive one.
   *
   * `since` is a floor rather than a window because the question is always
   * "over the last quarter", never "during March".
   */
  async allSince(since: Date): Promise<readonly Job[]> {
    const jobs = await this.db.$queryRawUnsafe<JobRow[]>(
      `${SELECT_JOB} WHERE j.created_at >= $1 ORDER BY j.created_at DESC`,
      since,
    );
    if (jobs.length === 0) return [];

    const decisions = await this.db.$queryRawUnsafe<DecisionRow[]>(
      `${SELECT_DECISIONS} WHERE l.job_id = ANY($1::uuid[])`,
      jobs.map((j) => j.id),
    );

    return jobs.map((j) => hydrate(j, decisions));
  }

  /** How many enquiries are waiting on a person. For the rail's badge. */
  async awaitingCount(): Promise<number> {
    const rows = await this.db.$queryRaw<{ count: bigint }[]>`
      SELECT count(*) FROM job WHERE status = 'review'`;
    return Number(rows[0]?.count ?? 0);
  }

  /** The enquiry a quote came from, for the screen that corrects one. */
  async byQuoteNumber(number: string): Promise<Job | undefined> {
    const rows = await this.db.$queryRawUnsafe<JobRow[]>(
      `${SELECT_JOB} WHERE q.number = $1`,
      number,
    );
    const job = rows[0];
    if (job === undefined) return undefined;

    const decisions = await this.db.$queryRawUnsafe<DecisionRow[]>(
      `${SELECT_DECISIONS} WHERE l.job_id = $1::uuid`,
      job.id,
    );
    return hydrate(job, decisions);
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
    /** The file the lines were read from. Omitted for a pasted enquiry. */
    readonly document?: {
      readonly text: string;
      readonly sources: readonly SourceRegion[];
    };
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
          sourceText: input.document?.text ?? null,
          // Spread into plain objects: Prisma's `InputJsonValue` will not take
          // a readonly interface, and it is right not to — what goes into a
          // JSONB column has to be data, not a typed view over data.
          lineSources:
            input.document === undefined
              ? Prisma.DbNull
              : input.document.sources.map((s) => ({ line: s.line, where: s.where })),
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
   *
   * **Provenance goes the same way, and for the same reason.** It is keyed by
   * position too, so after a correction it points at the wrong row of the
   * document — which is worse than pointing at nothing, because an engineer
   * would believe it. The document itself is kept: it is still what arrived.
   */
  async revise(
    reference: string,
    rawText: string,
    actor: Actor,
  ): Promise<{ readonly cleared: number }> {
    return this.db.$transaction(async (tx) => {
      const job = await tx.job.findUniqueOrThrow({ where: { reference } });
      const cleared = await tx.jobLine.deleteMany({ where: { jobId: job.id } });

      await tx.job.update({
        where: { reference },
        data: { rawText, lineSources: Prisma.DbNull },
      });

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

  /**
   * Puts a quoted job back in review so its quote can be corrected.
   *
   * `quoteId` is deliberately left pointing at the issued quote. It is what
   * says *this job has already been out to a customer*, and it is what the
   * approval path reads to know the next quote supersedes rather than
   * duplicates. Clearing it here would lose the only link between the mistake
   * and the correction.
   *
   * The quote itself is untouched. It is what the customer was told; the
   * correction is a new document that says so.
   */
  async reopen(reference: string, actor: Actor, reason: string): Promise<void> {
    await this.db.$transaction(async (tx) => {
      const job = await tx.job.findUniqueOrThrow({
        where: { reference },
        include: { quote: { select: { number: true } } },
      });

      await tx.job.update({ where: { reference }, data: { status: 'review' } });

      await tx.auditEvent.create({
        data: {
          actorId: actor.id,
          actorEmail: actor.email,
          entity: `job:${reference}`,
          field: 'status',
          previous: 'approved',
          next: 'review',
          reason: `Reopened to correct ${job.quote?.number ?? 'its quote'}: ${reason}`,
        },
      });
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
