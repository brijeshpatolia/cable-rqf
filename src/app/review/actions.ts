'use server';

import type { Route } from 'next';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { session } from '@/infra/auth/session';
import { quoteStore } from '@/infra/repositories';
import { authorise } from '@/modules/auth';
import { isPriced } from '@/modules/matching';
import { assembleQuote, type DraftLine } from '@/modules/quoting';
import { buildJob } from './job';

/**
 * Approving a job into a quote.
 *
 * Three refusals stand between a job and a document, and all three are checked
 * here on the server even though the screen already shows them:
 *
 *  1. **Authority.** Approval is the engineer's, not the rate owner's.
 *  2. **Blockers.** Unpriced or held lines stop the job, in the module.
 *  3. **Assembly.** `assembleQuote` refuses a quote carrying a line nobody
 *     costed, whatever the screen believed.
 *
 * The prices are recomputed here from the RFQ text rather than accepted from
 * the form. The browser is never the source of a number that reaches a
 * customer.
 */

export interface ApproveResult {
  readonly error?: string;
}

export async function approveJob(
  _previous: ApproveResult | null,
  form: FormData,
): Promise<ApproveResult> {
  const actor = await session.currentActor();
  const permitted = authorise(actor, 'quote.approve');
  if (!permitted.ok) return { error: permitted.failure.message };

  const customer = String(form.get('customer') ?? '').trim();
  if (customer === '') {
    return { error: 'A quote needs a customer. It is going to someone.' };
  }

  const rfq = String(form.get('rfq') ?? '');
  const termsRaw = String(form.get('terms') ?? '').trim();

  const { job, pricedAt } = await buildJob(rfq);

  if (job.blockers.length > 0) {
    return { error: `Cannot approve — ${job.blockers.join('; ')}.` };
  }

  const priced = job.lines.filter(isPriced);
  const lines: DraftLine[] = priced.map((l) => ({
    requestText: l.extracted.raw,
    productCode: l.product.id,
    sourceSheet: l.product.sourceSheet ?? '',
    designation: l.product.designation,
    quantityMetres: l.breakdown.quantity,
    breakdown: l.breakdown,
  }));

  const assembled = assembleQuote({
    customer,
    lines,
    unpricedCount: job.lines.length - priced.length,
    pricedAt,
    terms: termsRaw === '' ? null : termsRaw,
    actor: permitted.actor,
  });
  if (!assembled.ok) return { error: assembled.error.message };

  const { number } = await quoteStore.approve(
    assembled.value,
    permitted.actor,
  );

  // The new quote is open, so it is now part of the copper exposure the price
  // watch reports on.
  revalidatePath('/quotes');
  revalidatePath('/price-watch');

  redirect(`/quotes/${number}` as Route);
}
