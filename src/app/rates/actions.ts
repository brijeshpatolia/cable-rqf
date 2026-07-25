'use server';

import { revalidatePath } from 'next/cache';
import { dec } from '@/core/decimal';
import { now } from '@/infra/clock';
import { session } from '@/infra/auth/session';
import { repositories, rateWriter } from '@/infra/repositories';
import { authorise } from '@/modules/auth';
import { planLmeEntry, planSupersede, type RateKind } from '@/modules/rates';

/**
 * The rate write path, as Server Actions.
 *
 * Each of these is a thin adapter: check authority, parse input, ask the pure
 * module what the change *is*, and hand the plan to the writer. No business
 * logic lives here — that is what keeps the rule testable without a browser.
 *
 * The authority check is first in every one, and it is repeated server-side
 * even though the UI already hides the controls: a hidden button is not a
 * permission, and a Server Action is a public endpoint.
 */

export interface ActionResult {
  readonly error?: string;
  readonly ok?: string;
}

function parseDecimal(raw: FormDataEntryValue | null, what: string) {
  const text = String(raw ?? '').trim();
  if (text === '') return { error: `Enter a ${what}.` } as const;
  try {
    const value = dec(text);
    if (!value.isFinite()) return { error: `${what} must be a number.` } as const;
    return { value } as const;
  } catch {
    return { error: `${what} must be a number.` } as const;
  }
}

export async function supersedeRate(
  _previous: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  const actor = await session.currentActor();
  const permitted = authorise(actor, 'rate.edit');
  if (!permitted.ok) return { error: permitted.failure.message };

  const kind = String(form.get('kind') ?? 'material') as RateKind;
  const code = String(form.get('code') ?? '').trim();
  const reason = String(form.get('reason') ?? '');

  const value = parseDecimal(form.get('value'), 'rate');
  if ('error' in value) return { error: value.error };

  const premiumRaw = String(form.get('premium') ?? '').trim();
  const premium = premiumRaw === '' ? undefined : dec(premiumRaw);

  const current = await rateWriter.currentRate(kind, code);

  const plan = planSupersede(
    {
      kind,
      code,
      newValue: value.value,
      ...(premium !== undefined ? { newDrawingPremium: premium } : {}),
      at: now(),
      reason,
      actor: permitted.actor,
    },
    current,
  );
  if (!plan.ok) return { error: plan.error.message };

  const written = await rateWriter.applySupersede(plan.value);
  if (!written.ok) return { error: written.error.message };

  // Every screen that prices anything is downstream of a rate.
  for (const path of ['/rates', '/catalogue', '/review', '/price-watch']) {
    revalidatePath(path);
  }
  revalidatePath('/catalogue/[id]', 'page');

  return { ok: `${code} superseded. The previous value is kept, closed at now.` };
}

export async function enterLmePrice(
  _previous: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  const actor = await session.currentActor();
  const permitted = authorise(actor, 'lme.enter');
  if (!permitted.ok) return { error: permitted.failure.message };

  const lme = parseDecimal(form.get('lme'), 'copper price');
  if ('error' in lme) return { error: lme.error };

  const fx = parseDecimal(form.get('fx'), 'FX rate');
  if ('error' in fx) return { error: fx.error };

  const history = await repositories.rates.lmeHistory(1);
  const latest = history[0];

  const plan = planLmeEntry(
    { at: now(), lme: lme.value, fx: fx.value, actor: permitted.actor },
    latest === undefined ? undefined : { at: latest.at, lme: latest.lme },
  );
  if (!plan.ok) return { error: plan.error.message };

  const written = await rateWriter.applyLmeEntry(plan.value);
  if (!written.ok) return { error: written.error.message };

  for (const path of ['/rates', '/catalogue', '/review', '/price-watch']) {
    revalidatePath(path);
  }
  revalidatePath('/catalogue/[id]', 'page');

  return {
    ok: `Copper set to ${lme.value.toString()} USD/t. Every product containing copper has repriced.`,
  };
}
