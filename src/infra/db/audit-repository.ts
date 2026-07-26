import type { PrismaClient } from '@prisma/client';
import type { AuditEvent, AuditRepository } from '@/modules/rates';
import { prisma as defaultClient } from './client';

interface Row {
  readonly at: Date;
  readonly actor: string;
  readonly entity: string;
  readonly field: string;
  readonly previous: string;
  readonly next: string;
  readonly reason: string | null;
}

/**
 * The audit trail, read back.
 *
 * The rows have been written since the first migration — every rate change,
 * design revision, quote transition and enquiry correction. Nothing read them,
 * so the composition root kept the in-memory adapter and the Rate Desk's
 * promise that "every change is logged with who, when, and the previous value"
 * was true and unverifiable at the same time.
 *
 * Read-only by construction, and not merely by convention: `audit_event`
 * carries triggers that reject UPDATE and DELETE outright, so this class has
 * no write path to offer and the database would refuse one if it did.
 *
 * The actor's *name* is preferred over the stored email — the email is what
 * survives an account being deleted, so it is what the row keeps, but a person
 * reading the history recognises "B. Patolia" faster than an address.
 */
export class DbAuditRepository implements AuditRepository {
  constructor(private readonly db: PrismaClient = defaultClient) {}

  async forEntity(entity: string, limit: number): Promise<readonly AuditEvent[]> {
    return this.hydrate(
      await this.db.$queryRaw<Row[]>`
        SELECT a.at, coalesce(u.name, a.actor_email) AS actor, a.entity, a.field,
               a.previous, a.next, a.reason
          FROM audit_event a
          LEFT JOIN app_user u ON u.id = a.actor_id
         WHERE a.entity = ${entity}
         ORDER BY a.at DESC
         LIMIT ${limit}`,
    );
  }

  async recent(limit: number): Promise<readonly AuditEvent[]> {
    return this.hydrate(
      await this.db.$queryRaw<Row[]>`
        SELECT a.at, coalesce(u.name, a.actor_email) AS actor, a.entity, a.field,
               a.previous, a.next, a.reason
          FROM audit_event a
          LEFT JOIN app_user u ON u.id = a.actor_id
         ORDER BY a.at DESC
         LIMIT ${limit}`,
    );
  }

  /**
   * Which subjects still exist.
   *
   * **The trail outlives what it describes, deliberately.** `audit_event`
   * refuses DELETE, so a quote that was created and later removed leaves its
   * whole history behind — which is the entire point of keeping one. The
   * screen still has to know, because a link to a quote that no longer exists
   * is a 404 that reads as *the app is broken* rather than *this is gone*.
   *
   * Three cheap set reads rather than one existence check per row: the trail
   * is dominated by a handful of subjects with many events each, so the
   * per-row query would be almost entirely repeats.
   */
  async liveSubjects(): Promise<{
    readonly quotes: ReadonlySet<string>;
    readonly jobs: ReadonlySet<string>;
    readonly products: ReadonlySet<string>;
    readonly codes: ReadonlySet<string>;
  }> {
    const [quotes, jobs, products, codes] = await Promise.all([
      this.db.$queryRaw<{ n: string }[]>`SELECT number AS n FROM quote`,
      this.db.$queryRaw<{ n: string }[]>`SELECT reference AS n FROM job`,
      this.db.$queryRaw<{ n: string }[]>`SELECT DISTINCT code AS n FROM product`,
      // Both masters in one set: a code is a material or a machine, never
      // both, and the screen only needs to know whether it is still held.
      this.db.$queryRaw<{ n: string }[]>`
        SELECT DISTINCT code AS n FROM material_rate
        UNION
        SELECT DISTINCT code AS n FROM machine_rate`,
    ]);
    return {
      quotes: new Set(quotes.map((r) => r.n)),
      jobs: new Set(jobs.map((r) => r.n)),
      products: new Set(products.map((r) => r.n)),
      codes: new Set(codes.map((r) => r.n)),
    };
  }

  /**
   * How much history there is, so the screen can say what it is not showing.
   *
   * A page that silently caps at 500 rows and never mentions the other 4,000
   * is telling an engineer the trail ends where the query did.
   */
  async count(): Promise<number> {
    const rows = await this.db.$queryRaw<{ count: bigint }[]>`
      SELECT count(*) FROM audit_event`;
    return Number(rows[0]?.count ?? 0);
  }

  private hydrate(rows: readonly Row[]): readonly AuditEvent[] {
    return rows.map((r) => ({
      at: r.at,
      actor: r.actor,
      entity: r.entity,
      field: r.field,
      previous: r.previous,
      next: r.next,
      // `exactOptionalPropertyTypes` means an absent reason must be an absent
      // key, not a key holding undefined.
      ...(r.reason === null ? {} : { reason: r.reason }),
    }));
  }
}
