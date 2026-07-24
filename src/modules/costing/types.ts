import type { Decimal } from '@/core/decimal';
import type {
  Hours,
  KgPerKm,
  Kg,
  Metre,
  OMR,
  OMRPerHour,
  OMRPerKg,
  OMRPerKm,
  OMRPerMetre,
  OMRPerUSD,
  Percent,
  USDPerTonne,
} from '@/core/units';

/**
 * Provenance. Every terminal number in a breakdown carries one of these, so
 * the question "where did this come from?" always has an answer without
 * leaving the screen. A leaf without provenance fails the build.
 */
export interface RateSource {
  readonly rateId: string;
  readonly effectiveFrom: Date;
  /** e.g. `material_rate`, `machine_rate`, `lme` — shown in the audit drawer. */
  readonly table: string;
  /** Set when the value derives from the live LME rather than a fixed rate. */
  readonly lmeLinked?: boolean;
}

// ── Inputs ──────────────────────────────────────────────────────────────

export interface BomLine {
  readonly materialKey: string;
  readonly materialName: string;
  /** Consumption before scrap. */
  readonly consumption: KgPerKm;
  /** Scrap allowance, as a percentage added to consumption. */
  readonly scrapPercent: Percent;
}

export interface MachineOp {
  readonly machineKey: string;
  readonly machineName: string;
  /** Stage order — the breakdown lists operations in process sequence. */
  readonly sequence: number;
  readonly hoursPerKm: Hours;
  /**
   * Machine time scales with cores for stranding and insulation stages, and
   * doesn't for sheathing or armouring. The spec's `hours × cores × rate`
   * holds only where this is true.
   */
  readonly scalesWithCores: boolean;
}

export interface OverheadLine {
  readonly key: string;
  readonly name: string;
  /**
   * Per-product constants imported from the sheets. The 8 overhead lines per
   * product follow no formula and are stored, not derived (spec Part 5). A
   * rule is only needed for *new* products, in Phase 4.
   */
  readonly amount: OMRPerKm;
}

export interface Product {
  readonly id: string;
  readonly designation: string;
  readonly cores: number;
  /** mm² — the nominal conductor cross-section. */
  readonly sizeMm2: Decimal;
  readonly family: string;
  readonly bom: readonly BomLine[];
  readonly operations: readonly MachineOp[];
  readonly overheads: readonly OverheadLine[];
}

export interface MaterialRate {
  readonly rate: OMRPerKg;
  readonly source: RateSource;
}

export interface MachineRate {
  readonly rate: OMRPerHour;
  readonly source: RateSource;
}

/**
 * Rates resolved as of an instant, by the caller. The engine never resolves
 * them itself — that's what keeps it pure and makes reconstruction on historic
 * rates the same code path as pricing today.
 */
export interface ResolvedRateSet {
  readonly asOf: Date;
  readonly materials: ReadonlyMap<string, MaterialRate>;
  readonly machines: ReadonlyMap<string, MachineRate>;
  readonly copper: CopperRate;
}

/**
 * The live copper driver.
 *
 * OMR/kg = LME USD/t × FX ÷ 1000 + drawing premium for the size.
 *
 * Reverse-engineered from the sheets and flagged "assumed, pending
 * confirmation" in the UI until Nuhas confirms it (spec Part 5).
 */
export interface CopperRate {
  readonly lme: USDPerTonne;
  readonly fx: OMRPerUSD;
  /** Per-size table, not a constant — a 1.5mm² wire draws harder than 300mm². */
  readonly drawingPremiumBySize: ReadonlyMap<string, OMRPerKg>;
  readonly source: RateSource;
}

export interface CommercialTerms {
  readonly marginPercent: Percent;
  readonly drumCost: OMRPerKm;
  readonly packingCost: OMRPerKm;
  readonly freightCost: OMRPerKm;
}

export interface Quantity {
  readonly metres: Metre;
}

/** Material keys the copper driver applies to. */
export const COPPER_MATERIAL_KEYS: ReadonlySet<string> = new Set([
  'CU_ROD',
  'CU_CONDUCTOR',
  'CU_WIRE',
]);

// ── Output: the breakdown tree ──────────────────────────────────────────

export interface MaterialCostLine {
  readonly materialKey: string;
  readonly materialName: string;
  readonly consumption: KgPerKm;
  readonly scrapPercent: Percent;
  /** Consumption after scrap — the quantity actually costed. */
  readonly effectiveConsumption: KgPerKm;
  readonly rate: OMRPerKg;
  readonly cost: OMRPerKm;
  readonly source: RateSource;
}

export interface MachineCostLine {
  readonly machineKey: string;
  readonly machineName: string;
  readonly sequence: number;
  readonly hours: Hours;
  readonly rate: OMRPerHour;
  readonly cost: OMRPerKm;
  readonly source: RateSource;
}

export interface OverheadCostLine {
  readonly key: string;
  readonly name: string;
  readonly cost: OMRPerKm;
  readonly source: RateSource;
}

export interface CommercialBreakdown {
  readonly marginPercent: Percent;
  readonly marginAmount: OMRPerKm;
  readonly drumCost: OMRPerKm;
  readonly packingCost: OMRPerKm;
  readonly freightCost: OMRPerKm;
}

/**
 * The whole tree, returned from one call.
 *
 * The summary and the detail are the same object, so they cannot disagree —
 * and the UI's expandable row is a render of this structure, never a second
 * computation.
 */
export interface CostBreakdown {
  readonly productId: string;
  readonly designation: string;

  readonly materials: readonly MaterialCostLine[];
  readonly materialsSubtotal: OMRPerKm;

  readonly operations: readonly MachineCostLine[];
  readonly operationsSubtotal: OMRPerKm;

  readonly overheads: readonly OverheadCostLine[];
  readonly overheadsSubtotal: OMRPerKm;

  readonly costPerKm: OMRPerKm;
  readonly costPerMetre: OMRPerMetre;

  readonly commercial: CommercialBreakdown;
  readonly unitRate: OMRPerMetre;

  readonly quantity: Metre;
  readonly lineTotal: OMR;

  /** Total copper mass, for the price-watch exposure calculation. */
  readonly copperMassPerKm: Kg;

  /** The strike — printed under every breakdown and stamped on every quote. */
  readonly strike: {
    readonly lme: USDPerTonne;
    readonly fx: OMRPerUSD;
    readonly copperOmrPerKg: OMRPerKg;
    readonly asOf: Date;
  };
}
