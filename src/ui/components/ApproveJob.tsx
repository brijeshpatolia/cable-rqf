'use client';

import { useActionState } from 'react';
import type { ActionResult } from '@/app/jobs/actions';

type Action = (p: ActionResult | null, f: FormData) => Promise<ActionResult>;

/**
 * The approve control.
 *
 * Two rules from DESIGN_SYSTEM.md §9 govern this component. A disabled action
 * always states its condition — so when the job is blocked the button carries
 * the reason rather than sitting grey and silent. And the consequence is
 * stated before the action, not after: approving freezes a price, starts a
 * clock, and closes the job to further edits.
 *
 * Nothing numeric is submitted. The action re-derives the whole job from the
 * stored text and decisions, because a Server Action is a public endpoint and
 * a price that arrived over the wire is a price nobody at Nuhas computed.
 */
export function ApproveJob({
  action,
  describeAction,
  reference,
  blockers,
  lineCount,
  handPriced,
  customer,
  terms,
  canApprove,
}: {
  readonly action: Action;
  readonly describeAction: Action;
  readonly reference: string;
  readonly blockers: readonly string[];
  readonly lineCount: number;
  readonly handPriced: number;
  readonly customer: string | null;
  readonly terms: string | null;
  /** False for a viewer or rate owner — approval is the engineer's. */
  readonly canApprove: boolean;
}) {
  const [state, submit, pending] = useActionState(action, {});
  const [saved, save, saving] = useActionState(describeAction, {});
  const blocked = blockers.length > 0 || !canApprove;

  return (
    <div className="mt-5 flex flex-col gap-4">
      {/*
        Customer and terms save on their own, so an engineer can name the
        customer while red lines are still open rather than losing the typing
        when approval is refused.
      */}
      <form action={save} className="flex flex-col gap-3">
        <input type="hidden" name="reference" value={reference} />

        <label className="flex flex-col gap-1">
          <span className="label">Customer</span>
          <input
            name="customer"
            defaultValue={customer ?? ''}
            placeholder="Muscat Electricals LLC"
            style={input}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="label">Terms (optional)</span>
          <input
            name="terms"
            defaultValue={terms ?? ''}
            placeholder="Ex-works Sohar, 60 days, delivery 6–8 weeks"
            style={input}
          />
        </label>

        <button type="submit" disabled={saving} style={quiet}>
          {saving ? 'Saving…' : saved.ok !== undefined ? 'Saved' : 'Save details'}
        </button>
      </form>

      <form action={submit} className="flex flex-col gap-3">
        <input type="hidden" name="reference" value={reference} />

        <p style={note}>
          Approving freezes {lineCount} line{lineCount === 1 ? '' : 's'} at
          today&rsquo;s copper, starts a 30-day clock, and closes this job to
          further edits. The complete cost build-up is stored with the quote, so
          the price can still be explained after the market has moved.
        </p>

        {handPriced > 0 ? (
          <p style={{ ...note, color: 'var(--color-status-review)' }}>
            {handPriced} line{handPriced === 1 ? '' : 's'} on this quote{' '}
            {handPriced === 1 ? 'was' : 'were'} priced by hand and{' '}
            {handPriced === 1 ? 'carries' : 'carry'} no cost build-up. The
            quote&rsquo;s copper figure excludes {handPriced === 1 ? 'it' : 'them'},
            and both exports say so.
          </p>
        ) : null}

        {state.error !== undefined ? (
          <p role="alert" style={{ ...note, color: 'var(--color-status-manual)' }}>
            {state.error}
          </p>
        ) : null}

        <button type="submit" disabled={blocked || pending} style={primary(blocked || pending)}>
          {!canApprove
            ? 'Approve — only an engineer may approve a quote'
            : blockers.length > 0
              ? `Approve — ${blockers.join(', ')}`
              : pending
                ? 'Approving…'
                : 'Approve and quote'}
        </button>
      </form>
    </div>
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
  alignSelf: 'flex-start',
  border: '1px solid var(--color-line-strong)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--color-ink-secondary)',
  padding: '4px 12px',
  fontSize: 'var(--text-micro)',
};

const primary = (quietly: boolean): React.CSSProperties => ({
  backgroundColor: quietly ? 'var(--color-surface-raised)' : 'var(--color-copper)',
  color: quietly ? 'var(--color-ink-tertiary)' : 'var(--color-ink-on-copper)',
  border: quietly ? '1px solid var(--color-line-hairline)' : 'none',
  borderRadius: 'var(--radius-md)',
  padding: '8px 12px',
  fontWeight: 550,
  minHeight: 'var(--row-height)',
  cursor: quietly ? 'not-allowed' : 'pointer',
  textAlign: 'left',
});
