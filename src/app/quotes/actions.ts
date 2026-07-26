'use server';

import type { Route } from 'next';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { session } from '@/infra/auth/session';
import { jobStore, quoteStore } from '@/infra/repositories';
import { authorise } from '@/modules/auth';

export interface QuoteActionResult {
  readonly error?: string;
  readonly submitted?: Readonly<Record<string, string>>;
}

/**
 * Correcting a quote that has already gone out.
 *
 * `quote_is_immutable_once_approved` has been telling people to "supersede it
 * with a new quote" since the day it was written, and there was no way to. An
 * approved quote with a mistake in it was simply stuck — and a stuck quote
 * does not stay stuck, it moves to a phone call and a private spreadsheet,
 * which is where this app's record of what a customer was told stops being
 * true.
 *
 * The correction is not an edit. The issued quote is left exactly as it was,
 * because it is what the customer was told; the job goes back into review so
 * the mistake can be fixed, and approving it again issues a new document that
 * records which one it replaces.
 *
 * The engineer's, not the Rate Owner's: `quote.approve` is the capability that
 * puts a price in front of a customer, and taking one back is the same act.
 */
export async function reopenQuote(
  _previous: QuoteActionResult | null,
  form: FormData,
): Promise<QuoteActionResult> {
  const actor = await session.currentActor();
  const permitted = authorise(actor, 'quote.approve');
  if (!permitted.ok) return { error: permitted.failure.message };

  const number = String(form.get('number') ?? '').trim();
  const reason = String(form.get('reason') ?? '').trim();
  const submitted = { reason };

  if (reason === '') {
    return {
      error:
        'Say what is wrong with it. This is the sentence that explains to ' +
        'anyone reading the trail later why a customer got two quotes.',
      submitted,
    };
  }

  const quote = await quoteStore.byNumber(number);
  if (quote === undefined) return { error: `${number} was not found.`, submitted };

  if (quote.status === 'draft') {
    return {
      error: `${number} is still a draft, so there is nothing to supersede.`,
      submitted,
    };
  }

  if (quote.supersededBy !== null) {
    return {
      error: `${number} has already been replaced by ${quote.supersededBy}.`,
      submitted,
    };
  }

  const job = await jobStore.byQuoteNumber(number);
  if (job === undefined) {
    return {
      error:
        `${number} has no enquiry behind it, so there is nothing to reopen. ` +
        'A quote is corrected by re-approving the job it came from.',
      submitted,
    };
  }

  await jobStore.reopen(job.reference, permitted.actor, reason);

  revalidatePath('/');
  revalidatePath('/quotes');
  revalidatePath(`/quotes/${number}`);
  revalidatePath('/price-watch');

  redirect(`/jobs/${job.reference}` as Route);
}
