/** The matching module's public surface. */
export { parseLine } from './parse';
export type { ExtractedField, ExtractedLine } from './parse';
export {
  CORE_PARAMETERS,
  MATCH_AXES,
  SUBSTITUTION_RULES,
  axisLabel,
  isPriceable,
  matchLine,
  missingFields,
} from './match';
export type {
  AxisDifference,
  Candidate,
  MatchAxis,
  MatchOptions,
  MatchResult,
  SubstitutionRule,
  Tier,
} from './match';
export { byReviewOrder, isHeld, isPriced, reviewJob } from './review';
export type { Job, ReviewLine, ReviewOptions } from './review';
export { deriveBounds, validate } from './validate';
export type { Bounds, CheckCode, Range, Violation } from './validate';
export { VOCABULARY, canonicalise, fold, phrasesFor } from './vocabulary';
export type { Axis, Term, UnknownTerm } from './vocabulary';
