'use server';

import { revalidatePath } from 'next/cache';
import { dec } from '@/core/decimal';
import { now } from '@/infra/clock';
import { session } from '@/infra/auth/session';
import { repositories, rateWriter } from '@/infra/repositories';
import { authorise } from '@/modules/auth';
import {
  planAmendRate,
  planCreateRate,
  planLmeEntry,
  planSupersede,
  type RateKind,
} from '@/modules/rates';

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

/**
 * Every screen downstream of a rate, in one place.
 *
 * `/review` was in this list and is now `/` and `/jobs/[reference]`; a job's
 * prices are recomputed on every render, so a rate change has to reach them.
 * Listing the paths once means the next screen that prices something gets
 * added here rather than to four call sites, three of which somebody forgets.
 */
function revalidateRateDependents() {
  for (const path of ['/', '/rates', '/catalogue', '/price-watch']) {
    revalidatePath(path);
  }
  revalidatePath('/catalogue/[id]', 'page');
  revalidatePath('/jobs/[reference]', 'page');
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

/**
 * The drawing premium field, which may be left blank.
 *
 * It used to go straight through `dec()`, which throws on "abc" — so a typo
 * in this one box crashed the action instead of answering it, while the rate
 * box beside it was parsed properly. Blank is not a premium; anything else
 * has to be a number, and the plan decides whether a number is allowed.
 */
function parsePremium(raw: FormDataEntryValue | null) {
  const text = String(raw ?? '').trim();
  if (text === '') return { value: undefined } as const;
  const parsed = parseDecimal(text, 'drawing premium');
  return 'error' in parsed ? parsed : ({ value: parsed.value } as const);
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

  const premium = parsePremium(form.get('premium'));
  if ('error' in premium) return { error: premium.error };

  const current = await rateWriter.currentRate(kind, code);

  const plan = planSupersede(
    {
      kind,
      code,
      newValue: value.value,
      ...(premium.value !== undefined ? { newDrawingPremium: premium.value } : {}),
      at: now(),
      reason,
      actor: permitted.actor,
    },
    current,
  );
  if (!plan.ok) return { error: plan.error.message };

  const written = await rateWriter.applySupersede(plan.value);
  if (!written.ok) return { error: written.error.message };

  revalidateRateDependents();

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

  revalidateRateDependents();

  return {
    ok: `Copper set to ${lme.value.toString()} USD/t. Every product containing copper has repriced.`,
  };
}

/**
 * Adding a code to the master.
 *
 * Sudhir's second finding: the Rate Desk could change what a material *costs*
 * but not what the master *holds*. Adding a code was a spreadsheet job, which
 * meant the app's library and the real one drifted apart the first time a new
 * material arrived.
 */
export async function createRate(
  _previous: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  const actor = await session.currentActor();
  const permitted = authorise(actor, 'rate.edit');
  if (!permitted.ok) return { error: permitted.failure.message };

  const kind = String(form.get('kind') ?? 'material') as RateKind;
  const code = String(form.get('code') ?? '');
  const lmeLinked = form.get('lmeLinked') === 'on';

  const value = parseDecimal(form.get('value'), 'rate');
  if ('error' in value) return { error: value.error };

  const premium = parsePremium(form.get('premium'));
  if ('error' in premium) return { error: premium.error };

  const plan = planCreateRate(
    {
      kind,
      code,
      description: String(form.get('description') ?? ''),
      uom: String(form.get('uom') ?? ''),
      value: value.value,
      lmeLinked,
      ...(premium.value === undefined ? {} : { drawingPremium: premium.value }),
      at: now(),
      reason: String(form.get('reason') ?? ''),
      actor: permitted.actor,
    },
    await rateWriter.currentRate(kind, code.trim().toUpperCase()),
  );
  if (!plan.ok) return { error: plan.error.message };

  const written = await rateWriter.applyCreate(plan.value);
  if (!written.ok) return { error: written.error.message };

  revalidateRateDependents();
  return {
    ok: `${plan.value.code} added to the master. It is available to every bill of materials from now.`,
  };
}

/** Changes what a code is — its description, unit, or whether it tracks copper. */
export async function amendRate(
  _previous: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  const actor = await session.currentActor();
  const permitted = authorise(actor, 'rate.edit');
  if (!permitted.ok) return { error: permitted.failure.message };

  const kind = String(form.get('kind') ?? 'material') as RateKind;
  const code = String(form.get('code') ?? '').trim();
  const premium = parsePremium(form.get('premium'));
  if ('error' in premium) return { error: premium.error };

  const plan = planAmendRate(
    {
      kind,
      code,
      description: String(form.get('description') ?? ''),
      uom: String(form.get('uom') ?? ''),
      lmeLinked: form.get('lmeLinked') === 'on',
      ...(premium.value === undefined ? {} : { drawingPremium: premium.value }),
      at: now(),
      reason: String(form.get('reason') ?? ''),
      actor: permitted.actor,
    },
    await rateWriter.currentRate(kind, code),
  );
  if (!plan.ok) return { error: plan.error.message };

  const written = await rateWriter.applyAmend(plan.value);
  if (!written.ok) return { error: written.error.message };

  revalidateRateDependents();
  return { ok: `${code} amended. ${plan.value.audit.next}.` };
}
