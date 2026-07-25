'use client';

import { useActionState } from 'react';
import type { ApproveResult } from '@/app/review/actions';

/**
 * The approve control.
 *
 * Two rules from DESIGN_SYSTEM.md §9 govern this component. A disabled action
 * always states its condition — so when the job is blocked the button carries
 * the reason rather than sitting grey and silent. And the consequence is
 * stated before the action, not after: approving freezes a price and starts a
 * clock, and the note says so.
 *
 * The RFQ travels in a hidden field so the server re-prices it. What the
 * browser cannot do is send a price.
 */
export function ApproveJob({
  action,
  blockers,
  rfq,
  lineCount,
  canApprove,
}: {
  readonly action: (
    previous: ApproveResult | null,
    form: FormData,
  ) => Promise<ApproveResult>;
  readonly blockers: readonly string[];
  readonly rfq: string;
  readonly lineCount: number;
  /** False for a viewer or rate owner — approval is the engineer's. */
  readonly canApprove: boolean;
}) {
  const [state, submit, pending] = useActionState(action, {});
  const blocked = blockers.length > 0 || !canApprove;

  return (
    <form action={submit} className="mt-5 flex flex-col gap-3">
      <input type="hidden" name="rfq" value={rfq} />

      <label className="flex flex-col gap-1">
        <span className="label">Customer</span>
        <input
          name="customer"
          placeholder="Muscat Electricals LLC"
          required
          style={input}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="label">Terms (optional)</span>
        <input
          name="terms"
          placeholder="Ex-works Sohar, 60 days, delivery 6–8 weeks"
          style={input}
        />
      </label>

      <p style={note}>
        Approving freezes {lineCount} line{lineCount === 1 ? '' : 's'} at
        today&rsquo;s copper and starts a 30-day clock. The complete cost
        build-up is stored with the quote, so the price can still be explained
        after the market has moved.
      </p>

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
              : 'Approve job'}
      </button>
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

const primary = (quiet: boolean): React.CSSProperties => ({
  backgroundColor: quiet ? 'var(--color-surface-raised)' : 'var(--color-copper)',
  color: quiet ? 'var(--color-ink-tertiary)' : 'var(--color-ink-on-copper)',
  border: quiet ? '1px solid var(--color-line-hairline)' : 'none',
  borderRadius: 'var(--radius-md)',
  padding: '8px 12px',
  fontWeight: 550,
  minHeight: 'var(--row-height)',
  cursor: quiet ? 'not-allowed' : 'pointer',
  textAlign: 'left',
});
