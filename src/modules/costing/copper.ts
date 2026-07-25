import { type Decimal, dec, ZERO } from '@/core/decimal';
import { type Result, costError, err, ok } from '@/core/result';
import { omrPerKg, type OMRPerKg } from '@/core/units';
import type { CopperRate } from './types';

/**
 * The copper driver, isolated in one module with one test file — so a
 * correction to the formula is a one-line change plus a re-run of the parity
 * harness, not an archaeology exercise.
 *
 *     OMR/kg = LME (USD/t) × FX (OMR/USD) ÷ 1000 + drawing premium (OMR/kg)
 *
 * The ÷ 1000 converts tonnes to kilograms. The drawing premium is a per-size
 * table: drawing 1.5mm² wire costs more per kilogram than 300mm².
 *
 * ASSUMED, PENDING CONFIRMATION — reverse-engineered from the sheets. The UI
 * shows this caveat under the copper block until Nuhas confirms it, at which
 * point the flag below is cleared.
 */
export const COPPER_FORMULA_CONFIRMED = false;

/** The spec's stated default. Effective-dated in the database; this is a seed. */
export const DEFAULT_FX = '0.3845';

const KG_PER_TONNE = dec(1000);

export function copperRatePerKg(
  copper: CopperRate,
  sizeKey: string,
): Result<OMRPerKg> {
  const premium: Decimal = copper.drawingPremiumBySize.get(sizeKey) ?? ZERO;

  if (!copper.drawingPremiumBySize.has(sizeKey)) {
    return err(
      costError(
        'MISSING_RATE',
        `No drawing premium held for size ${sizeKey}. Copper cannot be priced without it.`,
        sizeKey,
      ),
    );
  }

  const base = copper.lme.times(copper.fx).dividedBy(KG_PER_TONNE);
  return ok(omrPerKg(base.plus(premium)));
}

/** The size key used to look up a drawing premium. `50` → `"50"`, `1.5` → `"1.5"`. */
export function sizeKeyOf(sizeMm2: Decimal): string {
  return sizeMm2.toString();
}
