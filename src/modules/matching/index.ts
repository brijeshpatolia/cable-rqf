/** The matching module's public surface. */
export { parseLine } from './parse';
export type { ExtractedField, ExtractedLine } from './parse';
export {
  CORE_PARAMETERS,
  MATCH_AXES,
  SUBSTITUTION_RULES,
  axisLabel,
  differencesBetween,
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
export {
  byReviewOrder,
  hasBreakdown,
  isHeld,
  isManual,
  isPriced,
  pricedValueOf,
  reviewJob,
} from './review';
export type {
  Job,
  LineDecision,
  LineStatus,
  Override,
  ProductChoice,
  ReviewLine,
  ReviewOptions,
} from './review';
export { deriveBounds, validate } from './validate';
export type { Bounds, CheckCode, Range, Violation } from './validate';
export {
  BUILT_IN_DICTIONARY,
  BUILT_IN_TERMS,
  buildDictionary,
  canonicalise,
  fold,
  mergeTerms,
  phrasesFor,
} from './vocabulary';
export type { Axis, Dictionary, Term, UnknownTerm } from './vocabulary';
