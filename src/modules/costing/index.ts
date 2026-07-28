/**
 * The costing module's public surface.
 *
 * Other modules and infra/ import from here, never from the files behind it —
 * that is what lets the internals be reshaped without a ripple
 * (ARCHITECTURE.md rule 2, enforced by `pnpm lint:arch`).
 */
export { computeCost, breakdownLeaves } from './engine';
export { compositionOf } from './composition';
export type { CostPart } from './composition';
export {
  COPPER_FORMULA_CONFIRMED,
  DEFAULT_FX,
  SOURCE_SHEET_LME,
  copperMetalValue,
  effectiveMaterialRate,
} from './copper';
export type {
  BomLine,
  CableSpec,
  CommercialBreakdown,
  CommercialTerms,
  CopperRate,
  CostBreakdown,
  MachineCostLine,
  MachineOp,
  MachineRate,
  MaterialCostLine,
  MaterialRate,
  OverheadCostLine,
  OverheadLine,
  Product,
  Quantity,
  RateSource,
  ResolvedRateSet,
} from './types';
