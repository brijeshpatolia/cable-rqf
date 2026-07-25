'use client';

import { useActionState, useState } from 'react';
import type { ActionResult } from '@/app/jobs/actions';

/**
 * The enquiry text, correctable.
 *
 * The document reader deliberately leaves rows out — a quantity of "TBC" is
 * not a quantity worth guessing at — so somebody has to be able to put them
 * back, and a reader that drops lines with no way to recover them would be
 * worse than no reader at all.
 *
 * It costs something. Decisions are keyed by line position, so inserting a
 * line renumbers everything below it and "price line 4 by hand" would quietly
 * become a decision about line 5. Every decision is therefore cleared, and the
 * count is stated before the button rather than discovered after it.
 *
 * Read-only until asked for: an engineer opening a job to review it should see
 * the customer's words, not an edit box inviting them to change them.
 */
export function ReviseEnquiry({
  action,
  reference,
  rawText,
  decisionCount,
  canRevise,
}: {
  readonly action: (p: ActionResult | null, f: FormData) => Promise<ActionResult>;
  readonly reference: string;
  readonly rawText: string;
  readonly decisionCount: number;
  readonly canRevise: boolean;
}) {
  const [state, submit, pending] = useActionState(action, {});
  const [wantsToEdit, setEditing] = useState(false);

  // A successful save closes the box on its own. Leaving it open would make
  // the engineer wonder whether it saved, and the outcome — including how many
  // decisions were cleared — belongs in the view they end up looking at.
  const editing = wantsToEdit && state.ok === undefined;

  if (!editing) {
    return (
      <>
        <pre className="numeric" style={text}>
          {rawText}
        </pre>
        {canRevise ? (
          <div style={footer}>
            {state.ok !== undefined ? (
              <span role="status" style={{ ...note, color: 'var(--color-status-exact)' }}>
                {state.ok}
              </span>
            ) : (
              <span style={note}>
                A line the reader left out can be added back here.
              </span>
            )}
            <button type="button" onClick={() => setEditing(true)} style={quiet}>
              Correct the text
            </button>
          </div>
        ) : null}
      </>
    );
  }

  return (
    <form action={submit}>
      <input type="hidden" name="reference" value={reference} />
      <textarea
        name="rfq"
        defaultValue={rawText}
        rows={Math.max(5, rawText.split('\n').length + 1)}
        spellCheck={false}
        className="numeric w-full"
        style={{ ...text, resize: 'vertical', backgroundColor: 'transparent', border: 'none', outline: 'none', color: 'var(--color-ink-primary)' }}
      />

      <div style={{ ...footer, flexWrap: 'wrap' }}>
        {decisionCount > 0 ? (
          <span style={{ ...note, color: 'var(--color-status-review)', width: '100%' }}>
            Saving will clear the {decisionCount} decision
            {decisionCount === 1 ? '' : 's'} on this job. Line numbers move when
            the text changes, so a decision about line 4 would quietly become a
            decision about a different cable.
          </span>
        ) : (
          <span style={{ ...note, width: '100%' }}>
            One cable per line, with the quantity at the end.
          </span>
        )}

        {state.error !== undefined ? (
          <span role="alert" style={{ ...note, color: 'var(--color-status-manual)', width: '100%' }}>
            {state.error}
          </span>
        ) : null}

        <button type="button" onClick={() => setEditing(false)} style={quiet}>
          Cancel
        </button>
        <button type="submit" disabled={pending} style={primary(pending)}>
          {pending ? 'Re-pricing…' : 'Save and re-price'}
        </button>
      </div>
    </form>
  );
}

const text: React.CSSProperties = {
  display: 'block',
  margin: 0,
  padding: 16,
  textAlign: 'left',
  color: 'var(--color-ink-secondary)',
  fontSize: 'var(--text-micro)',
  lineHeight: '18px',
  whiteSpace: 'pre-wrap',
};

const footer: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  padding: '8px 16px',
  borderTop: '1px solid var(--color-line-hairline)',
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
  padding: '4px 12px',
  fontSize: 'var(--text-micro)',
  whiteSpace: 'nowrap',
};

const primary = (pending: boolean): React.CSSProperties => ({
  backgroundColor: pending ? 'var(--color-surface-raised)' : 'var(--color-copper)',
  color: pending ? 'var(--color-ink-tertiary)' : 'var(--color-ink-on-copper)',
  borderRadius: 'var(--radius-sm)',
  padding: '4px 14px',
  fontWeight: 550,
  fontSize: 'var(--text-micro)',
  whiteSpace: 'nowrap',
});
