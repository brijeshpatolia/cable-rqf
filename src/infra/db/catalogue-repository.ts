import type { PrismaClient } from '@prisma/client';
import type { CreateProductPlan, Design, RevisePlan } from '@/modules/catalogue';
import { prisma as defaultClient } from './client';

/**
 * Writing a product's design.
 *
 * A design is replaced wholesale rather than diffed: the bill of materials,
 * the machine route and the overheads go out and the new ones go in, inside
 * one transaction. Diffing would be more code and no more correct — the
 * engineer edited a whole design, and half of one applied is worse than none.
 *
 * **Quotes already struck are unaffected**, and that is not luck. A quote
 * freezes its complete `CostBreakdown` as JSONB at approval, so it explains
 * itself from its own snapshot rather than by re-reading the library. Revising
 * a design changes what the *next* quote costs, never what a past one said.
 */
export class DbCatalogueRepository {
  constructor(private readonly db: PrismaClient = defaultClient) {}

  /** Every code in the library, so a new item cannot collide with one. */
  async codes(): Promise<ReadonlySet<string>> {
    const rows = await this.db.$queryRaw<{ code: string }[]>`SELECT code FROM product`;
    return new Set(rows.map((r) => r.code));
  }

  /** Products a person has changed. Parity excludes these, and says so. */
  async revisedCount(): Promise<number> {
    const rows = await this.db.$queryRaw<{ count: bigint }[]>`
      SELECT count(*) FROM product WHERE revised_at IS NOT NULL`;
    return Number(rows[0]?.count ?? 0);
  }

  /**
   * Who last revised a code, if anyone.
   *
   * The design screen warns that a product no longer matches the cost sheet it
   * was imported from, and a warning that cannot name the person who caused it
   * is an accusation with no address. Returns `null` for an untouched import
   * *and* for an item designed in the app, which never had a sheet to drift
   * from — its creation is not a revision, whatever the column says.
   */
  async revisedBy(code: string): Promise<string | null> {
    const rows = await this.db.$queryRaw<{ name: string }[]>`
      SELECT u.name
        FROM product p
        JOIN app_user u ON u.id = p.revised_by_id
       WHERE p.code = ${code}
         AND p.source_sheet <> 'designed in app'
       LIMIT 1`;
    return rows[0]?.name ?? null;
  }

  async revise(plan: RevisePlan, actorId: string): Promise<void> {
    await this.db.$transaction(async (tx) => {
      const product = await tx.product.findFirstOrThrow({
        where: { code: plan.code },
        select: { id: true },
      });

      await this.replaceDesign(tx, product.id, plan.design);

      await tx.product.update({
        where: { id: product.id },
        data: { revisedAt: new Date(), revisedById: actorId },
      });

      await tx.auditEvent.create({ data: { ...plan.audit } });
    });
  }

  async create(plan: CreateProductPlan, actorId: string): Promise<{ readonly id: string }> {
    return this.db.$transaction(async (tx) => {
      const created = await tx.product.create({
        data: {
          code: plan.code,
          // A hand-added item has no source cost sheet, and saying so is more
          // honest than borrowing a filename it never came from. The natural
          // key is (code, sourceSheet), so this doubles as the marker that it
          // was designed here rather than imported.
          sourceSheet: 'designed in app',
          designation: plan.designation,
          family: plan.family,
          standard: plan.spec.standard,
          cores: plan.spec.cores,
          sizeMm2: plan.spec.sizeMm2.toString(),
          conductor: plan.spec.conductor,
          insulation: plan.spec.insulation,
          screen: plan.spec.screen,
          armour: plan.spec.armour,
          sheath: plan.spec.sheath,
          voltage: plan.spec.voltage,
          toolingPerKm: plan.design.toolingPerKm.toString(),
          revisedAt: new Date(),
          revisedById: actorId,
        },
      });

      await this.replaceDesign(tx, created.id, plan.design);
      await tx.auditEvent.create({ data: { ...plan.audit } });

      return { id: created.id };
    });
  }

  /**
   * Out with the old design, in with the new.
   *
   * `position` is written from the array order, because the order an engineer
   * puts a bill of materials in is the order they read it back — and a costing
   * that reshuffled itself between renders would be unreadable however correct
   * the total.
   */
  private async replaceDesign(
    tx: Parameters<Parameters<PrismaClient['$transaction']>[0]>[0],
    productId: string,
    design: Design,
  ): Promise<void> {
    await tx.bomLine.deleteMany({ where: { productId } });
    await tx.machineOp.deleteMany({ where: { productId } });
    await tx.overheadLine.deleteMany({ where: { productId } });

    await tx.product.update({
      where: { id: productId },
      data: { toolingPerKm: design.toolingPerKm.toString() },
    });

    if (design.bom.length > 0) {
      await tx.bomLine.createMany({
        data: design.bom.map((l, position) => ({
          productId,
          materialKey: l.materialKey,
          materialName: l.materialName,
          consumption: l.consumption.toString(),
          scrap: l.scrap.toString(),
          position,
        })),
      });
    }

    if (design.operations.length > 0) {
      await tx.machineOp.createMany({
        data: design.operations.map((o, sequence) => ({
          productId,
          machineKey: o.machineKey,
          machineName: o.machineName,
          sequence,
          hoursPerKm: o.hoursPerKm.toString(),
          cores: o.cores.toString(),
        })),
      });
    }

    if (design.overheads.length > 0) {
      await tx.overheadLine.createMany({
        data: design.overheads.map((o, position) => ({
          productId,
          key: o.key,
          name: o.name,
          amount: o.amount.toString(),
          position,
        })),
      });
    }
  }
}
