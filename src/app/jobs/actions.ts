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
import { readDocument } from '@/infra/extraction/read-document';
import { buildJob } from './build';

/**
 * The upload ceiling.
 *
 * Not a performance guard — a 20 MB "RFQ" is a scanned one, and this app does
 * not read scans. Saying so at the door is kinder than reading it, finding no
 * text, and saying so afterwards.
 */
const MAX_UPLOAD_BYTES = 8_000_000;

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

/** CRLF out, trailing whitespace off each line, blank lines at the ends gone. */
const normalise = (text: string) =>
  text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.trimEnd())
    .join('\n')
    .trim();

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

  const rawText = normalise(String(form.get('rfq') ?? ''));
  if (rawText === '') {
    return { error: 'Paste the enquiry first — one cable per line.' };
  }

  const customer = String(form.get('customer') ?? '').trim();

  const at = now();
  const { reference } = await jobStore.open({
    rawText,
    customer: customer === '' ? null : customer,
    source: 'paste',
    sourceName: 'pasted',
    actor: permitted.actor,
    at,
  });

  // A customer used these words. Counted here rather than on render, so the
  // Vocabulary screen's "seen this month" measures enquiries and not refreshes.
  await vocabularyStore.sightedIn(rawText, at);

  revalidatePath('/');
  redirect(`/jobs/${reference}` as Route);
}

/**
 * Opens a job from an uploaded document.
 *
 * The reading happens here and its result is stored as ordinary RFQ text, so
 * the review screen never learns that a file was involved. That is the phase
 * boundary working: extraction ends exactly where paste begins, and Phase 2 did
 * not change to accommodate it.
 *
 * A document that could not be read still opens a job — carrying its raw text
 * and a stated reason. Refusing to create anything would leave the engineer
 * with a rejected upload and nowhere to put the enquiry; this way they can
 * paste over the text and carry on.
 */
export async function openJobFromFile(
  _previous: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  const actor = await session.currentActor();
  const permitted = authorise(actor, 'read');
  if (!permitted.ok) return { error: permitted.failure.message };

  const file = form.get('document');
  if (!(file instanceof File) || file.size === 0) {
    return { error: 'Choose a file first.' };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return {
      error: `${file.name} is ${(file.size / 1_000_000).toFixed(1)} MB. The limit is ${MAX_UPLOAD_BYTES / 1_000_000} MB — an RFQ that large is usually a scan, which this app does not read.`,
    };
  }

  /*
    A reader that throws must not take the page down with it.

    Everything else in this action refuses in words and returns; this one did
    not, so a file the PDF library could not open — encrypted, truncated, or
    built by something it disagrees with — replaced the whole screen with
    "Application error: a server-side exception has occurred" and lost the
    upload. Reported from production on a real customer RFQ.

    The reason is put in front of the engineer rather than only in a log they
    cannot read. This is an internal tool with ten accounts, all of whom would
    rather know what went wrong than be told something did — and the app's own
    rule is that a refusal states its condition. The alternative is what
    happened: a white screen and a digest number.
  */
  let read: Awaited<ReturnType<typeof readDocument>>;
  try {
    read = await readDocument(
      new Uint8Array(await file.arrayBuffer()),
      file.name,
      file.type,
    );
  } catch (cause) {
    const why = cause instanceof Error ? cause.message : String(cause);
    return {
      error:
        `${file.name} could not be read: ${why}. ` +
        'Paste the cable lines in instead — the enquiry is not lost.',
    };
  }

  const rawText = read.lines.length > 0 ? read.lines.join('\n') : read.rawText;
  if (rawText.trim() === '') {
    return { error: read.notes[0] ?? 'Nothing could be read from that file.' };
  }

  const at = now();
  const { reference } = await jobStore.open({
    rawText,
    customer: null,
    source: 'upload',
    sourceName: file.name,
    sourceNotes: read.notes,
    /*
      The document is kept beside the lines that were taken out of it, so an
      engineer can check a quantity against the file without going back to the
      attachment. When the reader failed, `rawText` already *is* the whole
      document — keeping a second copy of it would only offer to show the same
      text twice.
    */
    ...(read.lines.length > 0
      ? { document: { text: read.rawText, sources: read.sources } }
      : {}),
    actor: permitted.actor,
    at,
  });

  await vocabularyStore.sightedIn(rawText, at);
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

/**
 * Corrects the enquiry text.
 *
 * The document reader leaves rows out — a quantity of "TBC" is not a quantity
 * worth guessing at — so an engineer has to be able to put them back. The cost
 * is that decisions are keyed by line position and editing renumbers them, so
 * every decision on the job is cleared. Stated before the button, not after.
 */
export async function reviseJob(
  _previous: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  const actor = await session.currentActor();
  const permitted = authorise(actor, 'line.override');
  if (!permitted.ok) return { error: permitted.failure.message };

  const reference = String(form.get('reference') ?? '');
  // A textarea submits CRLF. Normalised on the way in, because the stored text
  // is what every later parse and every line number is counted from.
  const rawText = normalise(String(form.get('rfq') ?? ''));
  if (rawText === '') return { error: 'An enquiry with no lines is not an enquiry.' };

  const job = await jobStore.byReference(reference);
  if (job === undefined) return { error: `${reference} was not found.` };
  if (job.status !== 'review') {
    return { error: `${reference} has been quoted. Its text is the record of what was priced.` };
  }
  if (rawText === normalise(job.rawText)) return { ok: 'Nothing changed.' };

  const { cleared } = await jobStore.revise(reference, rawText, permitted.actor);
  jobPath(reference);

  return {
    ok:
      cleared === 0
        ? 'Enquiry updated and re-priced.'
        : `Enquiry updated and re-priced. ${cleared} decision${cleared === 1 ? '' : 's'} cleared, because the line numbers moved.`,
  };
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

  /*
    A job that already carries a quote is being corrected, not quoted for the
    first time. The new document records which one it replaces; the old row is
    never touched, because it is what the customer was told.

    Which one that is comes from the job row inside the write transaction, not
    from `persisted` — the read at the top of this action happened before the
    engine ran, and a correction takes long enough to price that "still under
    review when I looked" is not the same claim as "still under review now".
    The refusal below is what a second approver sees instead of a P2002.
  */
  const issued = await quoteStore.approve(assembled.value, permitted.actor, persisted.id);
  if (!issued.ok) return { error: issued.error };
  const { number } = issued.value;

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

  /*
    An enquiry mid-correction cannot just be dropped.

    Reopening a quote puts the job back in review while its issued quote stays
    standing — that is the whole design, because the customer has been told a
    price and nothing has replaced it yet. Closing the enquiry at that point
    used to leave the quote live: the price watch went on hedging its copper
    as a promise nobody intended to keep, and the record said the enquiry was
    closed while the document said the opposite.

    Refused rather than silently withdrawn. Retracting a price a customer is
    holding is a thing somebody decides and tells them about, not a side
    effect of tidying an inbox.
  */
  const job = await jobStore.byReference(reference);
  if (job === undefined) return { error: `${reference} was not found.` };

  if (job.status === 'review' && job.quoteNumber !== null) {
    return {
      error:
        `${reference} is correcting ${job.quoteNumber}, which is still the price ` +
        `${job.customer ?? 'the customer'} is holding. Finish the correction and ` +
        'approve it, or withdraw the quote first — closing the enquiry here would ' +
        'leave that promise standing with nothing behind it.',
    };
  }

  await jobStore.abandon(reference, permitted.actor, reason);
  revalidatePath('/');
  redirect('/');
}
