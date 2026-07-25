import type { PrismaClient } from '@prisma/client';
import type { Actor } from '@/modules/auth';
import type { MatchAxis, SubstitutionRule } from '@/modules/matching';
import { prisma as defaultClient } from './client';

/**
 * The substitution allowlist.
 *
 * Ships empty and stays empty until a Rate Owner decides otherwise. Every row
 * is a judgement someone made about what Nuhas can safely build, and it is
 * signed: who declared it, when, and why it is safe. A permissive allowlist is
 * how wrong prices get out, which is why the app never infers one from the
 * data even though it easily could.
 *
 * Retiring a rule closes it rather than deleting it. A quote struck through a
 * substitution has to stay explainable after the rule is withdrawn.
 */

export interface StoredRule extends SubstitutionRule {
  readonly id: string;
  readonly declaredBy: string | null;
  readonly declaredAt: Date;
  readonly retiredAt: Date | null;
}

interface Row {
  readonly id: string;
  readonly axis: string;
  readonly from_term: string;
  readonly to_term: string;
  readonly rationale: string;
  readonly declared_by: string | null;
  readonly created_at: Date;
  readonly retired_at: Date | null;
}

const SELECT = `
  SELECT s.id::text, s.axis, s.from_term, s.to_term, s.rationale,
         u.name AS declared_by, s.created_at, s.retired_at
    FROM substitution_rule s LEFT JOIN app_user u ON u.id = s.created_by_id`;

const toRule = (r: Row): StoredRule => ({
  id: r.id,
  axis: r.axis as MatchAxis,
  from: r.from_term,
  to: r.to_term,
  rationale: r.rationale,
  declaredBy: r.declared_by,
  declaredAt: r.created_at,
  retiredAt: r.retired_at,
});

export class DbSubstitutionRepository {
  constructor(private readonly db: PrismaClient = defaultClient) {}

  /** The rules the matcher may use. Retired ones are excluded. */
  async inForce(): Promise<readonly SubstitutionRule[]> {
    const rows = await this.db.$queryRawUnsafe<Row[]>(
      `${SELECT} WHERE s.retired_at IS NULL ORDER BY s.axis, s.from_term`,
    );
    return rows.map(toRule);
  }

  /** Everything, retired included — history is the product. */
  async all(): Promise<readonly StoredRule[]> {
    const rows = await this.db.$queryRawUnsafe<Row[]>(
      `${SELECT} ORDER BY s.retired_at IS NOT NULL, s.axis, s.from_term`,
    );
    return rows.map(toRule);
  }

  async declare(
    input: {
      readonly axis: MatchAxis;
      readonly from: string;
      readonly to: string;
      readonly rationale: string;
    },
    actor: Actor,
  ): Promise<void> {
    await this.db.$transaction(async (tx) => {
      await tx.substitutionRule.create({
        data: {
          axis: input.axis,
          fromTerm: input.from,
          toTerm: input.to,
          rationale: input.rationale,
          createdById: actor.id,
        },
      });

      await tx.auditEvent.create({
        data: {
          actorId: actor.id,
          actorEmail: actor.email,
          entity: `substitution:${input.axis}`,
          field: `${input.from} → ${input.to}`,
          previous: 'not allowed',
          next: 'allowed',
          reason: input.rationale,
        },
      });
    });
  }

  async retire(id: string, actor: Actor, reason: string): Promise<void> {
    await this.db.$transaction(async (tx) => {
      const rule = await tx.substitutionRule.update({
        where: { id },
        data: { retiredAt: new Date() },
      });

      await tx.auditEvent.create({
        data: {
          actorId: actor.id,
          actorEmail: actor.email,
          entity: `substitution:${rule.axis}`,
          field: `${rule.fromTerm} → ${rule.toTerm}`,
          previous: 'allowed',
          next: 'withdrawn',
          reason,
        },
      });
    });
  }
}
