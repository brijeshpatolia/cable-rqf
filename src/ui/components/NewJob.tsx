'use client';

import { useActionState } from 'react';
import type { ActionResult } from '@/app/jobs/actions';

/**
 * The intake.
 *
 * One textarea, one line per cable. Deliberately plain: until Phase 3 reads
 * the customer's document this is how every enquiry gets in, and the fastest
 * path from an email to a job is paste-and-go.
 */
export function NewJob({
  action,
}: {
  readonly action: (p: ActionResult | null, f: FormData) => Promise<ActionResult>;
}) {
  const [state, submit, pending] = useActionState(action, {});

  return (
    <form action={submit}>
      <textarea
        name="rfq"
        rows={5}
        required
        spellCheck={false}
        placeholder={
          '3C x 50mm2 Cu XLPE SWA PVC 1kV — 12,000 m\n' +
          '4C x 16 sq mm copper, XLPE, steel wire armoured, PVC, 0.6/1kV — 8,500 m'
        }
        className="numeric w-full"
        style={{
          display: 'block',
          margin: 0,
          padding: 16,
          textAlign: 'left',
          backgroundColor: 'transparent',
          border: 'none',
          outline: 'none',
          resize: 'vertical',
          color: 'var(--color-ink-primary)',
          fontSize: 'var(--text-micro)',
          lineHeight: '18px',
        }}
      />

      <div
        className="flex items-center gap-3"
        style={{
          padding: '8px 16px',
          borderTop: '1px solid var(--color-line-hairline)',
        }}
      >
        <input
          name="customer"
          placeholder="Customer (optional for now)"
          style={{
            backgroundColor: 'var(--color-surface-base)',
            border: '1px solid var(--color-line-strong)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--color-ink-primary)',
            padding: '5px 8px',
            fontSize: 'var(--text-body)',
            minHeight: 'var(--row-height)',
            flex: 1,
          }}
        />

        {state.error !== undefined ? (
          <span
            role="alert"
            style={{
              color: 'var(--color-status-manual)',
              fontSize: 'var(--text-micro)',
            }}
          >
            {state.error}
          </span>
        ) : null}

        <button
          type="submit"
          disabled={pending}
          style={{
            backgroundColor: pending
              ? 'var(--color-surface-raised)'
              : 'var(--color-copper)',
            color: pending ? 'var(--color-ink-tertiary)' : 'var(--color-ink-on-copper)',
            borderRadius: 'var(--radius-md)',
            padding: '6px 14px',
            fontWeight: 550,
            minHeight: 'var(--row-height)',
          }}
        >
          {pending ? 'Reading…' : 'Price this enquiry'}
        </button>
      </div>
    </form>
  );
}
