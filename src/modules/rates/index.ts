/** The rates module's public surface: effective dating and the storage ports. */
export {
  findOverlaps,
  isInForce,
  resolveAllAt,
  resolveAt,
  supersede,
} from './effective';
export type { DecimalRow, EffectiveRow, OverlapError } from './effective';
export { planLmeEntry, planSupersede } from './edit';
export type {
  CurrentRate,
  EditError,
  EditErrorCode,
  LmeEntryPlan,
  LmeEntryRequest,
  RateKind,
  SupersedePlan,
  SupersedeRequest,
} from './edit';
export type {
  AuditEvent,
  AuditRepository,
  LmeTick,
  ProductRepository,
  QuoteRepository,
  RateRepository,
} from './ports';
