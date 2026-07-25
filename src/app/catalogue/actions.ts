'use server';

import type { Route } from 'next';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { dec } from '@/core/decimal';
import { now } from '@/infra/clock';
import { session } from '@/infra/auth/session';
import { catalogueStore, rateWriter, repositories } from '@/infra/repositories';
import { authorise } from '@/modules/auth';
import {
  type Design,
  type KnownCodes,
  planCreateProduct,
  planRevise,
} from '@/modules/catalogue';

/**
 * The product library's write path.
 *
 * Two operations, and the difference between them is the whole of Nuhas's
 * third finding: **revising keeps the item code and the construction fixed**
 * and changes only how the cable is built. Adding an item sets everything
 * once. Nothing here can change what an existing cable *is*, so a revision can
 * never quietly turn a 3-core into a 4-core and reprice every enquiry that
 * matched it.
 */

export interface ActionResult {
  readonly error?: string;
  readonly ok?: string;
}

/**
 * The design, as the form submits it.
 *
 * Rows arrive as parallel arrays — `bomCode[]`, `bomConsumption[]` — which is
 * what a repeating fieldset produces. Reading them back positionally is the
 * one place the shape of the HTML leaks in, so it is done once, here.
 */
function readDesign(form: FormData): Design | { readonly error: string } {
  const rows = (name: string) => form.getAll(name).map((v) => String(v));

  const codes = rows('bomCode');
  const names = rows('bomName');
  const consumptions = rows('bomConsumption');
  const scraps = rows('bomScrap');

  const machineCodes = rows('opCode');
  const machineNames = rows('opName');
  const hours = rows('opHours');
  const multipliers = rows('opCores');

  const overheadKeys = rows('ohKey');
  const overheadNames = rows('ohName');
  const overheadAmounts = rows('ohAmount');

  try {
    const bom = codes
      .map((code, i) => ({
        materialKey: code,
        materialName: names[i] ?? '',
        consumption: dec(consumptions[i] || '0'),
        scrap: dec(scraps[i] || '0'),
      }))
      // A blank row is somebody adding a line and changing their mind, not an
      // error worth refusing the whole design over.
      .filter((l) => l.materialKey.trim() !== '');

    const operations = machineCodes
      .map((code, i) => ({
        machineKey: code,
        machineName: machineNames[i] ?? '',
        hoursPerKm: dec(hours[i] || '0'),
        cores: dec(multipliers[i] || '1'),
      }))
      .filter((o) => o.machineKey.trim() !== '');

    const overheads = overheadKeys
      .map((key, i) => ({
        key,
        name: overheadNames[i] ?? key,
        amount: dec(overheadAmounts[i] || '0'),
      }))
      .filter((o) => o.key.trim() !== '');

    return {
      bom,
      operations,
      overheads,
      toolingPerKm: dec(String(form.get('tooling') ?? '0') || '0'),
    };
  } catch {
    return { error: 'One of the quantities is not a number.' };
  }
}

async function knownCodes(): Promise<KnownCodes> {
  const master = await rateWriter.master();
  return {
    materials: new Set(
      master.filter((m) => m.kind === 'material').map((m) => m.code.toUpperCase()),
    ),
    machines: new Set(
      master.filter((m) => m.kind === 'machine').map((m) => m.code.toUpperCase()),
    ),
  };
}

function revalidateCatalogue(code?: string) {
  for (const path of ['/', '/catalogue', '/rates']) revalidatePath(path);
  revalidatePath('/catalogue/[id]', 'page');
  revalidatePath('/jobs/[reference]', 'page');
  if (code !== undefined) revalidatePath(`/catalogue/${code}`);
}

/** Changes how an existing item code is built, keeping what it is fixed. */
export async function reviseDesign(
  _previous: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  const actor = await session.currentActor();
  const permitted = authorise(actor, 'rate.edit');
  if (!permitted.ok) return { error: permitted.failure.message };

  const code = String(form.get('code') ?? '');
  const sheet = String(form.get('sourceSheet') ?? '');

  const library = await repositories.products.list();
  const product = library.find(
    (p) => p.id === code && (p.sourceSheet ?? '') === sheet,
  );
  if (product === undefined) return { error: `${code} is not in the library.` };

  const design = readDesign(form);
  if ('error' in design) return { error: design.error };

  const plan = planRevise({
    product,
    design,
    known: await knownCodes(),
    reason: String(form.get('reason') ?? ''),
    actor: permitted.actor,
    at: now(),
  });
  if (!plan.ok) return { error: plan.error.message };

  await catalogueStore.revise(plan.value, permitted.actor.id);
  revalidateCatalogue(code);

  return {
    ok:
      `${code} revised — ${plan.value.audit.next}. Every quote from now on ` +
      'uses this design; quotes already struck keep the one they were costed on.',
  };
}

/** Adds an item code, with its construction and its design. */
export async function createProduct(
  _previous: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  const actor = await session.currentActor();
  const permitted = authorise(actor, 'rate.edit');
  if (!permitted.ok) return { error: permitted.failure.message };

  const design = readDesign(form);
  if ('error' in design) return { error: design.error };

  const str = (name: string) => String(form.get(name) ?? '').trim();

  let sizeMm2;
  try {
    sizeMm2 = dec(str('sizeMm2') || '0');
  } catch {
    return { error: 'Conductor size is not a number.' };
  }

  const plan = planCreateProduct({
    code: str('code'),
    spec: {
      cores: Number(str('cores')),
      sizeMm2,
      conductor: str('conductor'),
      insulation: str('insulation'),
      screen: str('screen'),
      armour: str('armour'),
      sheath: str('sheath'),
      voltage: str('voltage'),
      standard: str('standard'),
    },
    family: str('family'),
    ...(str('designation') === '' ? {} : { designation: str('designation') }),
    design,
    known: await knownCodes(),
    existingCodes: await catalogueStore.codes(),
    reason: str('reason'),
    actor: permitted.actor,
  });
  if (!plan.ok) return { error: plan.error.message };

  await catalogueStore.create(plan.value, permitted.actor.id);
  revalidateCatalogue(plan.value.code);

  redirect(`/catalogue/${plan.value.code}` as Route);
}
