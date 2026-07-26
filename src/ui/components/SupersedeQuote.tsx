'use client';

import { useActionState, useState } from 'react';
import type { QuoteActionResult } from '@/app/quotes/actions';

type Action = (
  p: QuoteActionResult | null,
  f: FormData,
) => Promise<QuoteActionResult>;

/**
 * Correcting a quote that has already gone out.
 *
 * Deliberately behind a second click and a sentence. This is not an edit: it
 * reopens an enquiry a customer has already been answered on, and the next
 * approval sends them a second document. The friction is the point — and the
 * text says exactly what will happen before it happens, rather than after.
 *
 * The reason is required by the action, not only by the form. It ends up in
 * the audit trail, which is where anyone asking "why did this customer get two
 * quotes" will look.
 */
export function SupersedeQuote({
  action,
  number,
  supersededBy,
  canCorrect,
  reference,
}: {
  readonly action: Action;
  readonly number: string;
  /** The quote that already replaced this one, if any. */
  readonly supersededBy: string | null;
  readonly canCorrect: boolean;
  /** The enquiry behind it. Null when there is none to reopen. */
  readonly reference: string | null;
}) {
  const [state, submit, pending] = useActionState(action, {});
  const [open, setOpen] = useState(false);

  if (supersededBy !== null) {
    return (
      <p style={note}>
        Replaced by{' '}
        <a href={`/quotes/${supersededBy}`} style={{ color: 'var(--color-copper)' }}>
          {supersededBy}
        </a>
        . This document stays exactly as it was sent — it is what the customer
        was told, and the correction is a separate one that says so.
      </p>
    );
  }

  if (!canCorrect) {
    return (
      <p style={note}>
        Only an engineer can correct a quote. Sending a customer a second
        document is the same act as sending them the first.
      </p>
    );
  }

  if (reference === null) {
    return (
      <p style={note}>
        This quote has no enquiry behind it, so there is nothing to reopen. A
        quote is corrected by re-approving the job it came from.
      </p>
    );
  }

  if (!open) {
    return (
      <>
        {state.error !== undefined ? (
          <p role="alert" style={{ ...note, color: 'var(--color-status-manual)' }}>
            {state.error}
          </p>
        ) : null}
        <button type="button" onClick={() => setOpen(true)} style={quiet}>
          Correct this quote
        </button>
        <p className="mt-2" style={note}>
          Reopens {reference} so the mistake can be fixed. Approving it again
          issues a new quote that supersedes this one.
        </p>
      </>
    );
  }

  return (
    <form action={submit} className="flex flex-col gap-2">
      <input type="hidden" name="number" value={number} />
      <label className="flex flex-col gap-1">
        <span className="label">What is wrong with it</span>
        <input
          name="reason"
          defaultValue={state.submitted?.['reason'] ?? ''}
          placeholder="Quantity on line 2 was 8,500 m, not 850 m"
          required
          style={input}
        />
      </label>

      <p style={note}>
        {number} is left exactly as it was sent. {reference} goes back into
        review, and the quote you approve after it will say it supersedes this
        one.
      </p>

      {state.error !== undefined ? (
        <p role="alert" style={{ ...note, color: 'var(--color-status-manual)' }}>
          {state.error}
        </p>
      ) : null}

      <div className="flex gap-2">
        <button type="submit" disabled={pending} style={primary(pending)}>
          {pending ? 'Reopening…' : `Reopen ${reference}`}
        </button>
        <button type="button" onClick={() => setOpen(false)} style={quiet}>
          Cancel
        </button>
      </div>
    </form>
  );
}

const input: React.CSSProperties = {
  backgroundColor: 'var(--color-surface-base)',
  border: '1px solid var(--color-line-strong)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--color-ink-primary)',
  padding: '5px 8px',
  fontSize: 'var(--text-body)',
  minHeight: 'var(--row-height)',
  width: '100%',
};

const note: React.CSSProperties = {
  color: 'var(--color-ink-secondary)',
  fontSize: 'var(--text-micro)',
  lineHeight: 'var(--text-micro--line-height)',
};

const quiet: React.CSSProperties = {
  border: '1px solid var(--color-line-strong)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--color-ink-secondary)',
  padding: '5px 12px',
  fontSize: 'var(--text-micro)',
};

const primary = (pending: boolean): React.CSSProperties => ({
  backgroundColor: pending ? 'var(--color-surface-raised)' : 'var(--color-copper)',
  color: pending ? 'var(--color-ink-tertiary)' : 'var(--color-ink-on-copper)',
  borderRadius: 'var(--radius-md)',
  padding: '5px 14px',
  fontWeight: 550,
  fontSize: 'var(--text-micro)',
});
