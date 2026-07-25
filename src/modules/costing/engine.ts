import { dec, sum, ZERO } from '@/core/decimal';
import { type Result, all, costError, err, ok } from '@/core/result';
import {
  hours as asHours,
  kg,
  kgPerKm,
  omr,
  omrPerKm,
  omrPerMetre,
} from '@/core/units';
import { copperMetalValue, effectiveMaterialRate } from './copper';
import {
  type CommercialTerms,
  type CostBreakdown,
  type MachineCostLine,
  type MaterialCostLine,
  type OverheadCostLine,
  type Product,
  type Quantity,
  type ResolvedRateSet,
} from './types';

const METRES_PER_KM = dec(1000);

/**
 * The cost engine.
 *
 * Pure — no I/O, no clock, no randomness, no database. Total — it never
 * throws; anything it cannot cost comes back as a stated reason. Deterministic
 * — same inputs, same bytes out, which is what makes the parity harness
 * possible.
 *
 * It returns the whole tree rather than a number, because the UI's expandable
 * breakdown needs the tree anyway, and computing it twice would let the
 * summary and the detail disagree.
 *
 * Rates arrive already resolved as of an instant. That single choice is why
 * pricing today and reconstructing an eight-month-old quote are the same code
 * path.
 */
export function computeCost(
  product: Product,
  quantity: Quantity,
  rates: ResolvedRateSet,
  terms: CommercialTerms,
): Result<CostBreakdown> {
  if (product.bom.length === 0) {
    return err(
      costError(
        'MISSING_BOM',
        `${product.designation} has no bill of materials. It cannot be costed.`,
        product.id,
      ),
    );
  }

  // ── Materials ────────────────────────────────────────────────────────
  const materialResults = product.bom.map((line): Result<MaterialCostLine> => {
    // Scrap is an absolute quantity as entered in the source sheet, so the
    // costed quantity is simply consumption + scrap.
    const effective = kgPerKm(line.consumption.plus(line.scrap));

    const held = rates.materials.get(line.materialKey);
    if (held === undefined) {
      return err(
        costError(
          'MISSING_RATE',
          `No rate held for ${line.materialName}. This product cannot be priced until one is entered.`,
          line.materialKey,
        ),
      );
    }

    // Copper codes reprice live off the LME; every other material reads the
    // fixed rate it holds. One lookup path, one branch, decided by the rate.
    const rate = effectiveMaterialRate(held, rates.copper);

    return ok({
      materialKey: line.materialKey,
      materialName: line.materialName,
      consumption: line.consumption,
      scrap: line.scrap,
      effectiveConsumption: effective,
      rate,
      cost: omrPerKm(effective.times(rate)),
      lmeLinked: held.lmeLinked,
      source: held.lmeLinked
        ? { ...rates.copper.source, lmeLinked: true }
        : held.source,
    });
  });

  const materials = all(materialResults);
  if (!materials.ok) return materials;

  const materialsSubtotal = omrPerKm(sum(materials.value.map((m) => m.cost)));

  // ── Machine operations ───────────────────────────────────────────────
  const operationResults = [...product.operations]
    .sort((a, b) => a.sequence - b.sequence)
    .map((op): Result<MachineCostLine> => {
      const held = rates.machines.get(op.machineKey);
      if (held === undefined) {
        return err(
          costError(
            'UNKNOWN_MACHINE',
            `No hourly rate held for ${op.machineName}. This product cannot be priced until one is entered.`,
            op.machineKey,
          ),
        );
      }

      // Cost = machine hours × cores × machine rate, with cores taken from the
      // operation line rather than the product.
      const hours = asHours(op.hoursPerKm.times(dec(op.cores)));

      return ok({
        machineKey: op.machineKey,
        machineName: op.machineName,
        sequence: op.sequence,
        hours,
        cores: op.cores,
        rate: held.rate,
        cost: omrPerKm(hours.times(held.rate)),
        source: held.source,
      });
    });

  const operations = all(operationResults);
  if (!operations.ok) return operations;

  const operationsSubtotal = omrPerKm(sum(operations.value.map((o) => o.cost)));

  // ── Overheads ────────────────────────────────────────────────────────
  // Stored per product, not derived. The sheets' 8 lines follow no formula;
  // a rule is only needed for products that don't exist yet (Phase 4).
  const overheads: OverheadCostLine[] = product.overheads.map((o) => ({
    key: o.key,
    name: o.name,
    cost: o.amount,
    source: {
      rateId: `overhead:${product.id}:${o.key}`,
      effectiveFrom: rates.asOf,
      table: 'overhead_line',
    },
  }));

  const overheadsSubtotal = omrPerKm(sum(overheads.map((o) => o.cost)));

  // ── Roll-up ──────────────────────────────────────────────────────────
  // cost/km = raw material + operations + overheads + tooling, exactly as the
  // source sheets reconcile it.
  const costPerKm = omrPerKm(
    materialsSubtotal
      .plus(operationsSubtotal)
      .plus(overheadsSubtotal)
      .plus(product.toolingPerKm),
  );
  const costPerMetre = omrPerMetre(costPerKm.dividedBy(METRES_PER_KM));

  // Margin applies to manufactured cost; drum, packing, and freight are
  // pass-through and are added after, not marked up.
  const marginAmount = omrPerKm(
    costPerKm.times(terms.marginPercent).dividedBy(100),
  );

  const sellPerKm = omrPerKm(
    costPerKm
      .plus(marginAmount)
      .plus(terms.drumCost)
      .plus(terms.packingCost)
      .plus(terms.freightCost),
  );

  const unitRate = omrPerMetre(sellPerKm.dividedBy(METRES_PER_KM));

  // Exposure is the mass of LME-linked material, which is what a copper move
  // actually acts on.
  const copperMassPerKm = kg(
    sum(
      materials.value
        .filter((m) => m.lmeLinked)
        .map((m) => m.effectiveConsumption),
    ),
  );

  return ok({
    productId: product.id,
    designation: product.designation,
    materials: materials.value,
    materialsSubtotal,
    operations: operations.value,
    operationsSubtotal,
    overheads,
    overheadsSubtotal,
    tooling: product.toolingPerKm,
    costPerKm,
    costPerMetre,
    commercial: {
      marginPercent: terms.marginPercent,
      marginAmount,
      drumCost: terms.drumCost,
      packingCost: terms.packingCost,
      freightCost: terms.freightCost,
    },
    unitRate,
    quantity: quantity.metres,
    lineTotal: omr(unitRate.times(quantity.metres)),
    copperMassPerKm,
    strike: {
      lme: rates.copper.lme,
      fx: rates.copper.fx,
      copperOmrPerKg: copperMetalValue(rates.copper),
      asOf: rates.asOf,
    },
  });
}

/**
 * Every terminal number in a breakdown, with its provenance. The property test
 * walks this and asserts nothing is orphaned — a number with no origin is a
 * build failure (ARCHITECTURE.md §3).
 */
export function breakdownLeaves(
  breakdown: CostBreakdown,
): readonly { readonly label: string; readonly source: unknown }[] {
  return [
    ...breakdown.materials.map((m) => ({ label: m.materialName, source: m.source })),
    ...breakdown.operations.map((o) => ({ label: o.machineName, source: o.source })),
    ...breakdown.overheads.map((o) => ({ label: o.name, source: o.source })),
  ];
}

export { ZERO };
