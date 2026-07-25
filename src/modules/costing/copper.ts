import { dec } from '@/core/decimal';
import { omrPerKg, type OMRPerKg } from '@/core/units';
import type { CopperRate, MaterialRate } from './types';

/**
 * The copper driver, isolated in one module with one test file — so a
 * correction to the formula is a one-line change plus a re-run of the parity
 * harness, not an archaeology exercise.
 *
 *     OMR/kg = LME (USD/t) × FX (OMR/USD) ÷ 1000 + drawing premium (OMR/kg)
 *
 * The ÷ 1000 converts tonnes to kilograms. The drawing premium is held per
 * *material code*, not per size: the source workbook carries 39 LME-linked
 * copper codes, each with its own premium in the range 0.1026–0.1401 OMR/kg,
 * falling as conductor size rises.
 *
 * ASSUMED, PENDING CONFIRMATION. The workbook's own README states the premium
 * was derived by subtracting LME metal value from the rate in the source
 * sheets, and asks for the decomposition to be confirmed before quoting from
 * it. The UI carries that caveat until the flag below is cleared.
 */
export const COPPER_FORMULA_CONFIRMED = false;

/** The workbook's stated assumption: the Omani rial peg. */
export const DEFAULT_FX = '0.3845';

/** Every source sheet was costed at this LME (workbook README, assumption 2). */
export const SOURCE_SHEET_LME = '4850';

const KG_PER_TONNE = dec(1000);

/** LME metal value alone, before any drawing premium. */
export function copperMetalValue(copper: CopperRate): OMRPerKg {
  return omrPerKg(copper.lme.times(copper.fx).dividedBy(KG_PER_TONNE));
}

/**
 * The rate for a material as of the given copper driver.
 *
 * An LME-linked material is repriced live; everything else reads the fixed
 * rate it was imported with. This is the whole point of the app — a copper
 * move reflows every product that contains copper, and nothing else moves.
 */
export function effectiveMaterialRate(
  material: MaterialRate,
  copper: CopperRate,
): OMRPerKg {
  if (!material.lmeLinked) return material.rate;
  return omrPerKg(copperMetalValue(copper).plus(material.drawingPremium ?? 0));
}
