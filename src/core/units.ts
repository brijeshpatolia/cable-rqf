import type { Brand } from './brand';
import { type Decimal, dec } from './decimal';

/**
 * Branded quantities. The compiler refuses to let kilograms be added to Omani
 * rials, or a bare `number` to be costed. Every one of these is a Decimal at
 * runtime — the brand exists only at compile time and costs nothing.
 */
export type OMR = Brand<Decimal, 'OMR'>;
export type USD = Brand<Decimal, 'USD'>;
export type Kg = Brand<Decimal, 'Kg'>;
export type Metre = Brand<Decimal, 'Metre'>;
export type Km = Brand<Decimal, 'Km'>;
export type Hours = Brand<Decimal, 'Hours'>;
export type Percent = Brand<Decimal, 'Percent'>;
export type Tonne = Brand<Decimal, 'Tonne'>;

/** OMR per kilogram — the form every material rate takes. */
export type OMRPerKg = Brand<Decimal, 'OMRPerKg'>;
/** OMR per hour — machine rates. */
export type OMRPerHour = Brand<Decimal, 'OMRPerHour'>;
/** Kilograms per kilometre — every BOM line's consumption. */
export type KgPerKm = Brand<Decimal, 'KgPerKm'>;
/** OMR per kilometre, and per metre — the two costing altitudes. */
export type OMRPerKm = Brand<Decimal, 'OMRPerKm'>;
export type OMRPerMetre = Brand<Decimal, 'OMRPerMetre'>;
/** USD per tonne — the LME quote, and the only USD figure in the system. */
export type USDPerTonne = Brand<Decimal, 'USDPerTonne'>;
/** OMR per USD — the FX rate. Spec assumes 0.3845, pending confirmation. */
export type OMRPerUSD = Brand<Decimal, 'OMRPerUSD'>;

type Numeric = string | number | Decimal;

const make =
  <T extends Decimal>() =>
  (v: Numeric): T =>
    dec(v) as T;

export const omr = make<OMR>();
export const usd = make<USD>();
export const kg = make<Kg>();
export const metres = make<Metre>();
export const km = make<Km>();
export const hours = make<Hours>();
export const percent = make<Percent>();
export const omrPerKg = make<OMRPerKg>();
export const omrPerHour = make<OMRPerHour>();
export const kgPerKm = make<KgPerKm>();
export const omrPerKm = make<OMRPerKm>();
export const omrPerMetre = make<OMRPerMetre>();
export const usdPerTonne = make<USDPerTonne>();
export const omrPerUSD = make<OMRPerUSD>();

/** Strip the brand for arithmetic. Deliberately verbose — it should be visible. */
export function raw(value: Decimal): Decimal {
  return value;
}
