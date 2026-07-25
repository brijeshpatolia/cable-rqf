'use server';

import type { Route } from 'next';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { dec } from '@/core/decimal';
import { now } from '@/infra/clock';
import { session } from '@/infra/auth/session';
import {
  jobStore,
  quoteStore,
  substitutionStore,
  vocabularyStore,
} from '@/infra/repositories';
import { authorise } from '@/modules/auth';
import { planDecision } from '@/modules/jobs';
import { type Axis, type ReviewLine, hasBreakdown, isPriced } from '@/modules/matching';
import { type Decision, type DraftLine, assembleQuote } from '@/modules/quoting';
import { buildJob } from './build';

/**
 * The write path for a job under review.
 *
 * Each of these is a thin adapter: check authority, parse input, ask the pure
 * module what the change *is*, and hand the plan to the store. No business
 * logic lives here — that is what keeps the rules testable without a browser.
 *
 * The authority check is first in every one, repeated server-side even though
 * the screens already hide the controls. A hidden button is not a permission,
 * and a Server Action is a public endpoint.
 */

export interface ActionResult {
  readonly error?: string;
  readonly ok?: string;
  /**
   * What was submitted, echoed back.
   *
   * A refusal must not cost someone their typing. Next re-renders the server
   * component tree after an action, which remounts the form and resets every
   * uncontrolled input to its default — so an engineer who typed a rate and
   * forgot a reason would get told off *and* lose the rate. Echoing the values
   * back makes the defaults survive the round trip.
   */
  readonly submitted?: Readonly<Record<string, string>>;
}

const jobPath = (reference: string) => {
  revalidatePath('/');
  revalidatePath(`/jobs/${reference}`);
};

function parseRate(raw: FormDataEntryValue | null) {
  const text = String(raw ?? '').trim();
  if (text === '') return { value: undefined } as const;
  try {
    return { value: dec(text) } as const;
  } catch {
    return { error: 'That rate is not a number.' } as const;
  }
}

/** Opens a job on a pasted block of RFQ text. */
export async function openJob(
  _previous: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  const actor = await session.currentActor();
  const permitted = authorise(actor, 'read');
  if (!permitted.ok) return { error: permitted.failure.message };

  const rawText = String(form.get('rfq') ?? '').trim();
  if (rawText === '') {
    return { error: 'Paste the enquiry first — one cable per line.' };
  }

  const customer = String(form.get('customer') ?? '').trim();

  const { reference } = await jobStore.open({
    rawText,
    customer: customer === '' ? null : customer,
    source: 'paste',
    sourceName: 'pasted',
    actor: permitted.actor,
    at: now(),
  });

  revalidatePath('/');
  redirect(`/jobs/${reference}` as Route);
}

/**
 * Records one human's answer to one line.
 *
 * This is the action the whole review screen exists for: the app has said what
 * it cannot settle, and a person settles it. The module decides what the
 * answer *is* and refuses it in words; the database refuses it again as a
 * constraint. Both, deliberately — the constraint is the guarantee, the
 * message is the product.
 */
export async function decideLine(
  _previous: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  const actor = await session.currentActor();
  const permitted = authorise(actor, 'line.override');
  if (!permitted.ok) return { error: permitted.failure.message };

  const reference = String(form.get('reference') ?? '');
  const position = Number(form.get('position') ?? -1);
  if (!Number.isInteger(position) || position < 0) {
    return { error: 'That line no longer exists on this job.' };
  }

  const job = await jobStore.byReference(reference);
  if (job === undefined) return { error: `${reference} was not found.` };

  const submitted = {
    rate: String(form.get('rate') ?? ''),
    reason: String(form.get('reason') ?? ''),
    productCode: String(form.get('productCode') ?? ''),
  };

  const rate = parseRate(form.get('rate'));
  if ('error' in rate) return { error: rate.error, submitted };

  const code = submitted.productCode.trim();
  const sheet = String(form.get('sourceSheet') ?? '').trim();

  const plan = planDecision({
    job,
    position,
    ...(rate.value !== undefined ? { unitRate: rate.value } : {}),
    ...(code !== '' ? { product: { code, sourceSheet: sheet } } : {}),
    reason: String(form.get('reason') ?? ''),
    actor: permitted.actor,
    at: now(),
  });
  if (!plan.ok) return { error: plan.error.message, submitted };

  await jobStore.decide(job.id, plan.value, permitted.actor, reference);
  jobPath(reference);

  return { ok: `Line ${position + 1} settled. ${plan.value.summary}.` };
}

/** Withdraws a decision, leaving the line open again. */
export async function undecideLine(
  _previous: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  const actor = await session.currentActor();
  const permitted = authorise(actor, 'line.override');
  if (!permitted.ok) return { error: permitted.failure.message };

  const reference = String(form.get('reference') ?? '');
  const position = Number(form.get('position') ?? -1);

  const job = await jobStore.byReference(reference);
  if (job === undefined) return { error: `${reference} was not found.` };
  if (job.status !== 'review') {
    return { error: `${reference} has already been quoted.` };
  }

  await jobStore.undecide(job.id, position, permitted.actor, reference);
  jobPath(reference);

  return { ok: `Line ${position + 1} is open again.` };
}

/** The customer and terms an engineer types while reviewing. */
export async function describeJob(
  _previous: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  const actor = await session.currentActor();
  const permitted = authorise(actor, 'read');
  if (!permitted.ok) return { error: permitted.failure.message };

  const reference = String(form.get('reference') ?? '');
  const customer = String(form.get('customer') ?? '').trim();
  const terms = String(form.get('terms') ?? '').trim();

  await jobStore.describe(reference, {
    customer: customer === '' ? null : customer,
    terms: terms === '' ? null : terms,
  });
  jobPath(reference);

  return { ok: 'Saved.' };
}

/**
 * Teaches the dictionary a word an RFQ used that the app did not know.
 *
 * The Rate Owner's answer, not the engineer's: what a customer's word maps to
 * is a statement about Nuhas's catalogue, and getting it wrong prices every
 * future job containing that word.
 */
export async function teachTerm(
  _previous: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  const actor = await session.currentActor();
  const permitted = authorise(actor, 'rate.edit');
  if (!permitted.ok) return { error: permitted.failure.message };

  const phrase = String(form.get('phrase') ?? '').trim();
  const canonical = String(form.get('canonical') ?? '').trim();
  const axis = String(form.get('axis') ?? '').trim() as Axis;
  const reason = String(form.get('reason') ?? '').trim();

  if (phrase === '' || canonical === '') {
    return { error: 'A word and the term it means, please.' };
  }
  if (reason === '') {
    return { error: 'Say why. Every future job containing this word depends on it.' };
  }

  try {
    await vocabularyStore.teach({ canonical, axis, phrase, reason }, permitted.actor);
  } catch (e) {
    // The unique index on (axis, phrase) is the one that fires here, and it is
    // worth naming: one phrase meaning two things is how a line silently
    // prices as the wrong cable.
    const message = e instanceof Error ? e.message : String(e);
    return {
      error: message.includes('axis_phrase')
        ? `"${phrase}" already means something else on the ${axis} axis. ` +
          'One word cannot mean two things, or a line prices as whichever the ' +
          'database happened to return first.'
        : message,
    };
  }

  const reference = String(form.get('reference') ?? '');
  revalidatePath('/vocabulary');
  if (reference !== '') jobPath(reference);

  return { ok: `"${phrase}" now means ${canonical}. Every job knows it.` };
}

/** The Rate Owner declares a substitution safe. */
export async function declareSubstitution(
  _previous: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  const actor = await session.currentActor();
  const permitted = authorise(actor, 'rate.edit');
  if (!permitted.ok) return { error: permitted.failure.message };

  const axis = String(form.get('axis') ?? '').trim();
  const from = String(form.get('from') ?? '').trim();
  const to = String(form.get('to') ?? '').trim();
  const rationale = String(form.get('rationale') ?? '').trim();

  if (from === '' || to === '') return { error: 'Both terms, please.' };
  if (from === to) {
    return { error: 'A term substituted for itself matches everything and means nothing.' };
  }
  if (rationale === '') {
    return {
      error:
        'Say why this is safe. It will be shown on every line priced through ' +
        'it, and it is the only thing standing between a substitution and a ' +
        'wrong price.',
    };
  }

  try {
    await substitutionStore.declare(
      { axis: axis as never, from, to, rationale },
      permitted.actor,
    );
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }

  revalidatePath('/vocabulary');
  revalidatePath('/');
  return { ok: `${from} → ${to} is now an allowed substitution.` };
}

export async function retireSubstitution(
  _previous: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  const actor = await session.currentActor();
  const permitted = authorise(actor, 'rate.edit');
  if (!permitted.ok) return { error: permitted.failure.message };

  const id = String(form.get('id') ?? '');
  const reason = String(form.get('reason') ?? '').trim();
  if (reason === '') return { error: 'Say why it is being withdrawn.' };

  await substitutionStore.retire(id, permitted.actor, reason);
  revalidatePath('/vocabulary');
  return { ok: 'Withdrawn. Quotes already struck through it stay explainable.' };
}

/**
 * Turns a reviewed job into a quote.
 *
 * The prices are recomputed here from the stored text and decisions rather
 * than accepted from the form, for the same reason the review screen does not
 * send them: the browser is never the source of a number that reaches a
 * customer.
 */
export async function approveJob(
  _previous: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  const actor = await session.currentActor();
  const permitted = authorise(actor, 'quote.approve');
  if (!permitted.ok) return { error: permitted.failure.message };

  const reference = String(form.get('reference') ?? '');
  const persisted = await jobStore.byReference(reference);
  if (persisted === undefined) return { error: `${reference} was not found.` };
  if (persisted.status !== 'review') {
    return {
      error:
        persisted.quoteNumber === null
          ? `${reference} is closed.`
          : `${reference} is already quote ${persisted.quoteNumber}.`,
    };
  }

  const customer = String(form.get('customer') ?? persisted.customer ?? '').trim();
  if (customer === '') {
    return { error: 'A quote needs a customer. It is going to someone.' };
  }

  const { job, pricedAt, strike } = await buildJob(persisted);

  if (job.blockers.length > 0) {
    return { error: `Cannot approve — ${job.blockers.join('; ')}.` };
  }

  const priced = job.lines.filter(isPriced);
  const lines: DraftLine[] = priced.map((l) => ({
    requestText: l.extracted.raw,
    productCode: hasBreakdown(l) ? l.product.id : '',
    sourceSheet: hasBreakdown(l) ? (l.product.sourceSheet ?? '') : '',
    designation: hasBreakdown(l) ? l.product.designation : l.extracted.raw,
    quantityMetres: hasBreakdown(l) ? l.breakdown.quantity : l.lineTotal.dividedBy(l.unitRate),
    breakdown: hasBreakdown(l) ? l.breakdown : null,
    // A hand price and a chosen product are both decisions; the quote records
    // which by whether a rate came with it.
    decision: decisionOf(l),
  }));

  const terms = String(form.get('terms') ?? persisted.terms ?? '').trim();

  const assembled = assembleQuote({
    customer,
    lines,
    unpricedCount: job.lines.length - priced.length,
    strike,
    pricedAt,
    terms: terms === '' ? null : terms,
    actor: permitted.actor,
  });
  if (!assembled.ok) return { error: assembled.error.message };

  const { number, id } = await quoteStore.approve(assembled.value, permitted.actor);
  await jobStore.markQuoted(persisted.id, id);

  revalidatePath('/');
  revalidatePath('/quotes');
  revalidatePath('/price-watch');

  redirect(`/quotes/${number}` as Route);
}

/** The human decision on a review line, in the shape a quote line stores. */
function decisionOf(line: ReviewLine): Decision | null {
  const override = 'override' in line ? line.override : null;
  if (override !== null) {
    return {
      unitRate: override.unitRate,
      reason: override.reason,
      by: override.by,
      at: override.at,
    };
  }
  const choice = 'choice' in line ? line.choice : null;
  if (choice !== null && choice !== undefined) {
    return { unitRate: null, reason: choice.reason, by: choice.by, at: choice.at };
  }
  return null;
}

export async function abandonJob(
  _previous: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  const actor = await session.currentActor();
  const permitted = authorise(actor, 'line.override');
  if (!permitted.ok) return { error: permitted.failure.message };

  const reference = String(form.get('reference') ?? '');
  const reason = String(form.get('reason') ?? '').trim();
  if (reason === '') return { error: 'Say why this enquiry is being closed.' };

  await jobStore.abandon(reference, permitted.actor, reason);
  revalidatePath('/');
  redirect('/');
}
