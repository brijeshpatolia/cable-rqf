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
  /**
   * Scrap allowance as an absolute quantity, not a percentage.
   *
   * This is how the source sheets hold it ("Scrap qty is stored per BOM line
   * from the source sheets"), and storing it as entered is what lets the
   * parity harness reproduce them exactly. A percentage would round.
   */
  readonly scrap: KgPerKm;
}

export interface MachineOp {
  readonly machineKey: string;
  readonly machineName: string;
  /** Stage order — the breakdown lists operations in process sequence. */
  readonly sequence: number;
  readonly hoursPerKm: Hours;
  /**
   * The multiplier this stage runs at, held per operation.
   *
   * The source sheets call this column "Cores", but it is NOT an integer core
   * count: 117 of the library's 728 operation rows are fractional, ranging to
   * 97.2. It is a process multiplier — passes, or effective cores — and it is
   * carried as a Decimal because rounding it to an integer changes the cost.
   */
  readonly cores: Decimal;
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

/**
 * The nine fields that identify a cable.
 *
 * This is the canonical key matching compares against — an RFQ line is
 * normalised into this shape, and a library product exposes it directly.
 * Every value is a canonical term from the vocabulary, never a customer's
 * wording.
 */
export interface CableSpec {
  readonly cores: number;
  /** mm² — the nominal conductor cross-section. */
  readonly sizeMm2: Decimal;
  readonly conductor: string;
  readonly insulation: string;
  /** Empty when the cable carries no screen. */
  readonly screen: string;
  /** Empty when unarmoured. */
  readonly armour: string;
  readonly sheath: string;
  readonly voltage: string;
  readonly standard: string;
}

export interface Product {
  readonly id: string;
  readonly designation: string;
  readonly spec: CableSpec;
  readonly family: string;
  readonly bom: readonly BomLine[];
  readonly operations: readonly MachineOp[];
  readonly overheads: readonly OverheadLine[];
  /**
   * Tooling is its own roll-up component in the source sheets, not one of the
   * 8 overhead lines: cost/km = raw material + operations + overheads + tooling.
   */
  readonly toolingPerKm: OMRPerKm;
  /** The source cost sheet this product was imported from. Provenance. */
  readonly sourceSheet?: string;
}

export interface MaterialRate {
  /** The fixed rate, for materials that aren't LME-linked. */
  readonly rate: OMRPerKg;
  /** Copper codes reprice off the LME; everything else holds its rate. */
  readonly lmeLinked: boolean;
  /**
   * Drawing premium over LME metal value, held per material code — a thinner
   * conductor costs more per kilogram to draw. Set only on LME-linked codes.
   */
  readonly drawingPremium?: OMRPerKg;
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
  readonly source: RateSource;
}

export interface CommercialTerms {
  /** Applied to manufactured cost: quote = cost × (1 + margin). */
  readonly marginPercent: Percent;
  /**
   * Pass-through costs, added after margin rather than marked up. The source
   * sheets carry none of these — they stop at cost and margin — so parity runs
   * with all three at zero.
   */
  readonly drumCost: OMRPerKm;
  readonly packingCost: OMRPerKm;
  readonly freightCost: OMRPerKm;
}

export interface Quantity {
  readonly metres: Metre;
}

// ── Output: the breakdown tree ──────────────────────────────────────────

export interface MaterialCostLine {
  readonly materialKey: string;
  readonly materialName: string;
  readonly consumption: KgPerKm;
  readonly scrap: KgPerKm;
  /** Consumption plus scrap — the quantity actually costed. */
  readonly effectiveConsumption: KgPerKm;
  readonly rate: OMRPerKg;
  readonly cost: OMRPerKm;
  /** True when this line's rate came off the live LME. */
  readonly lmeLinked: boolean;
  readonly source: RateSource;
}

export interface MachineCostLine {
  readonly machineKey: string;
  readonly machineName: string;
  readonly sequence: number;
  readonly hours: Hours;
  readonly cores: Decimal;
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

  readonly tooling: OMRPerKm;

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
