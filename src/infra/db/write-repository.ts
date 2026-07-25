import type { PrismaClient } from '@prisma/client';
import { dec } from '@/core/decimal';
import { type Result, err, ok } from '@/core/result';
import type {
  AmendRatePlan,
  CreateRatePlan,
  CurrentRate,
  EditError,
  LmeEntryPlan,
  RateKind,
  SupersedePlan,
} from '@/modules/rates';
import { prisma as defaultClient } from './client';

/**
 * The rate write path.
 *
 * `modules/rates` decides *whether* a change is legitimate and what it becomes;
 * this performs it. Every write is one transaction containing the row being
 * closed, the row being opened, and the audit entry — so the rate and the
 * record of who changed it are always both present or both absent.
 *
 * The database is the backstop, not this code. If a concurrent edit slips
 * between the read and the write, the EXCLUDE constraint rejects it and that
 * surfaces here as a stated reason rather than a SQLSTATE.
 */

/** Postgres raises this for an exclusion-constraint violation. */
const EXCLUSION_VIOLATION = '23P01';
/** …and this for a unique index, which the partial in-force index uses. */
const UNIQUE_VIOLATION = '23505';

function isConflict(e: unknown): boolean {
  const code = (e as { code?: unknown } | null)?.code;
  return code === EXCLUSION_VIOLATION || code === UNIQUE_VIOLATION;
}

const CONFLICT: EditError = {
  code: 'NOT_IN_FORCE',
  message:
    'Someone else changed this rate a moment ago. Nothing was written — ' +
    'reload the rate desk and try again.',
};

export class DbRateWriter {
  constructor(private readonly db: PrismaClient = defaultClient) {}

  /**
   * Reads the row currently in force, so the caller can plan against it.
   *
   * Deliberately separate from `applySupersede`: the decision is a pure
   * function of this value, which is what makes the rule testable without a
   * database.
   */
  async currentRate(
    kind: RateKind,
    code: string,
  ): Promise<CurrentRate | undefined> {
    const table = kind === 'material' ? 'material_rate' : 'machine_rate';

    const rows =
      kind === 'material'
        ? await this.db.$queryRaw<
            {
              id: string;
              code: string;
              rate: string;
              lme_linked: boolean;
              drawing_premium: string | null;
              description: string;
              uom: string;
              valid_from: Date;
              valid_to: Date | null;
            }[]
          >`SELECT id::text, code, rate::text AS rate, lme_linked,
                   drawing_premium::text AS drawing_premium,
                   description, uom, valid_from, valid_to
              FROM material_rate WHERE code = ${code} AND valid_to IS NULL`
        : await this.db.$queryRaw<
            {
              id: string;
              code: string;
              rate: string;
              lme_linked: boolean;
              drawing_premium: string | null;
              description: string;
              uom: string;
              valid_from: Date;
              valid_to: Date | null;
            }[]
          >`SELECT id::text, code, rate::text AS rate, false AS lme_linked,
                   NULL::text AS drawing_premium, stage AS description,
                   'hour' AS uom, valid_from, valid_to
              FROM machine_rate WHERE code = ${code} AND valid_to IS NULL`;

    const row = rows[0];
    if (row === undefined) return undefined;

    return {
      row: {
        key: row.code,
        value: dec(row.rate),
        validFrom: row.valid_from,
        validTo: row.valid_to,
        rateId: row.id,
        table,
      },
      lmeLinked: row.lme_linked,
      drawingPremium:
        row.drawing_premium === null ? null : dec(row.drawing_premium),
      description: row.description,
      uom: row.uom,
    };
  }

  /**
   * Closes the old row, opens the new one, and writes the audit entry — all
   * in one transaction.
   *
   * The old row is closed with `valid_to IS NULL` in the WHERE clause, so a
   * concurrent edit that already closed it updates zero rows and the whole
   * transaction is abandoned. That is a lost-update guard, not an optimisation.
   */
  async applySupersede(plan: SupersedePlan): Promise<Result<void, EditError>> {
    try {
      await this.db.$transaction(async (tx) => {
        const closed =
          plan.kind === 'material'
            ? await tx.$executeRaw`
                UPDATE material_rate SET valid_to = ${plan.close.validTo}::timestamptz
                 WHERE id = ${plan.close.rateId}::uuid AND valid_to IS NULL`
            : await tx.$executeRaw`
                UPDATE machine_rate SET valid_to = ${plan.close.validTo}::timestamptz
                 WHERE id = ${plan.close.rateId}::uuid AND valid_to IS NULL`;

        if (closed !== 1) throw new ConcurrentChange();

        if (plan.kind === 'material') {
          await tx.$executeRaw`
            INSERT INTO material_rate
              (id, code, description, uom, rate, lme_linked, drawing_premium,
               valid_from, valid_to, created_at)
            SELECT gen_random_uuid(), code, description, uom,
                   ${plan.open.value.toString()}::numeric, lme_linked,
                   ${plan.open.drawingPremium?.toString() ?? null}::numeric,
                   ${plan.open.validFrom}::timestamptz, NULL, now()
              FROM material_rate WHERE id = ${plan.close.rateId}::uuid`;
        } else {
          await tx.$executeRaw`
            INSERT INTO machine_rate
              (id, code, stage, rate, valid_from, valid_to, created_at)
            SELECT gen_random_uuid(), code, stage,
                   ${plan.open.value.toString()}::numeric,
                   ${plan.open.validFrom}::timestamptz, NULL, now()
              FROM machine_rate WHERE id = ${plan.close.rateId}::uuid`;
        }

        await tx.auditEvent.create({
          data: {
            actorId: plan.audit.actorId,
            actorEmail: plan.audit.actorEmail,
            entity: plan.audit.entity,
            field: plan.audit.field,
            previous: plan.audit.previous,
            next: plan.audit.next,
            reason: plan.audit.reason,
          },
        });
      });

      return ok(undefined);
    } catch (e) {
      if (e instanceof ConcurrentChange || isConflict(e)) return err(CONFLICT);
      throw e;
    }
  }

  /**
   * The master as the Rate Desk shows it: every code in force, with what it is.
   *
   * A separate read rather than widening `ResolvedRateSet`, because that type
   * is the hot pricing path and a description is a label. The engine has no
   * business carrying one, and adding it there would mean every costing run
   * hauled 167 strings it never looks at.
   */
  async master(): Promise<
    readonly {
      kind: 'material' | 'machine';
      code: string;
      description: string;
      uom: string;
      rate: string;
      lmeLinked: boolean;
      drawingPremium: string | null;
    }[]
  > {
    const [materials, machines] = await Promise.all([
      this.db.$queryRaw<
        {
          code: string;
          description: string;
          uom: string;
          rate: string;
          lme_linked: boolean;
          drawing_premium: string | null;
        }[]
      >`SELECT code, description, uom, rate::text AS rate, lme_linked,
               drawing_premium::text AS drawing_premium
          FROM material_rate WHERE valid_to IS NULL ORDER BY code`,
      this.db.$queryRaw<{ code: string; stage: string; rate: string }[]>`
        SELECT code, stage, rate::text AS rate
          FROM machine_rate WHERE valid_to IS NULL ORDER BY code`,
    ]);

    return [
      ...materials.map((m) => ({
        kind: 'material' as const,
        code: m.code,
        description: m.description,
        uom: m.uom,
        rate: m.rate,
        lmeLinked: m.lme_linked,
        drawingPremium: m.drawing_premium,
      })),
      ...machines.map((m) => ({
        kind: 'machine' as const,
        code: m.code,
        description: m.stage,
        uom: 'hour',
        rate: m.rate,
        lmeLinked: false,
        drawingPremium: null,
      })),
    ];
  }

  /**
   * Adds a code to the master.
   *
   * Opens an effective-dated row exactly like a supersede does, so a code
   * added today has the same shape as one imported in January and the EXCLUDE
   * constraint governs both. There is nothing to close: the code did not
   * exist, which is what `planCreateRate` verified.
   */
  async applyCreate(plan: CreateRatePlan): Promise<Result<void, EditError>> {
    try {
      await this.db.$transaction(async (tx) => {
        if (plan.kind === 'material') {
          await tx.$executeRaw`
            INSERT INTO material_rate
              (id, code, description, uom, rate, lme_linked, drawing_premium,
               valid_from, valid_to, created_at)
            VALUES (gen_random_uuid(), ${plan.code}, ${plan.description}, ${plan.uom},
                    ${plan.value.toString()}::numeric, ${plan.lmeLinked},
                    ${plan.drawingPremium?.toString() ?? null}::numeric,
                    ${plan.validFrom}::timestamptz, NULL, now())`;
        } else {
          await tx.$executeRaw`
            INSERT INTO machine_rate
              (id, code, stage, rate, valid_from, valid_to, created_at)
            VALUES (gen_random_uuid(), ${plan.code}, ${plan.description},
                    ${plan.value.toString()}::numeric,
                    ${plan.validFrom}::timestamptz, NULL, now())`;
        }

        await tx.auditEvent.create({ data: { ...plan.audit } });
      });

      return ok(undefined);
    } catch (e) {
      if (isConflict(e)) return err(CONFLICT);
      throw e;
    }
  }

  /**
   * Changes what a code is, keeping its rate.
   *
   * Same close-and-reopen as a supersede, and for the same reason: whether a
   * code is LME-linked decides how every product containing it reprices, so it
   * is a pricing fact. A pricing fact that changed in place would make every
   * quote struck before the change unreconstructible.
   */
  async applyAmend(plan: AmendRatePlan): Promise<Result<void, EditError>> {
    try {
      await this.db.$transaction(async (tx) => {
        const closed =
          plan.kind === 'material'
            ? await tx.$executeRaw`
                UPDATE material_rate SET valid_to = ${plan.close.validTo}::timestamptz
                 WHERE id = ${plan.close.rateId}::uuid AND valid_to IS NULL`
            : await tx.$executeRaw`
                UPDATE machine_rate SET valid_to = ${plan.close.validTo}::timestamptz
                 WHERE id = ${plan.close.rateId}::uuid AND valid_to IS NULL`;

        if (closed !== 1) throw new ConcurrentChange();

        if (plan.kind === 'material') {
          await tx.$executeRaw`
            INSERT INTO material_rate
              (id, code, description, uom, rate, lme_linked, drawing_premium,
               valid_from, valid_to, created_at)
            VALUES (gen_random_uuid(), ${plan.code}, ${plan.open.description},
                    ${plan.open.uom}, ${plan.open.value.toString()}::numeric,
                    ${plan.open.lmeLinked},
                    ${plan.open.drawingPremium?.toString() ?? null}::numeric,
                    ${plan.open.validFrom}::timestamptz, NULL, now())`;
        } else {
          await tx.$executeRaw`
            INSERT INTO machine_rate
              (id, code, stage, rate, valid_from, valid_to, created_at)
            VALUES (gen_random_uuid(), ${plan.code}, ${plan.open.description},
                    ${plan.open.value.toString()}::numeric,
                    ${plan.open.validFrom}::timestamptz, NULL, now())`;
        }

        await tx.auditEvent.create({ data: { ...plan.audit } });
      });

      return ok(undefined);
    } catch (e) {
      if (e instanceof ConcurrentChange || isConflict(e)) return err(CONFLICT);
      throw e;
    }
  }

  /** A new copper tick, plus its audit entry, in one transaction. */
  async applyLmeEntry(plan: LmeEntryPlan): Promise<Result<void, EditError>> {
    try {
      await this.db.$transaction(async (tx) => {
        await tx.lmePrice.create({
          data: {
            at: plan.at,
            lme: plan.lme.toString(),
            fx: plan.fx.toString(),
            enteredBy: plan.enteredBy,
          },
        });

        await tx.auditEvent.create({
          data: {
            actorId: plan.audit.actorId,
            actorEmail: plan.audit.actorEmail,
            entity: plan.audit.entity,
            field: plan.audit.field,
            previous: plan.audit.previous,
            next: plan.audit.next,
            reason: plan.audit.reason,
          },
        });
      });

      return ok(undefined);
    } catch (e) {
      if (isConflict(e)) {
        return err({
          code: 'NOT_LATER',
          message:
            'A copper price already exists at that instant. ' +
            'Enter a later one — the series is never edited in place.',
        });
      }
      throw e;
    }
  }
}

class ConcurrentChange extends Error {}
