'use client';

import { useActionState } from 'react';
import type { ActionResult } from '@/app/jobs/actions';

const AXES = [
  ['conductor', 'Conductor'],
  ['insulation', 'Insulation'],
  ['screen', 'Screen'],
  ['armour', 'Armour'],
  ['sheath', 'Sheath'],
  ['voltage', 'Voltage'],
  ['standard', 'Standard'],
] as const;

/**
 * Answering "what does this word mean?"
 *
 * The app has refused to guess at a phrase it does not recognise, which is
 * right — but a refusal that cannot be answered is just an obstacle. One
 * sentence from the Rate Owner resolves it here and in every job afterwards,
 * which is the whole of the spec's promise that the app "stops asking after
 * the first months".
 *
 * The Rate Owner's decision, not the engineer's: what a customer's word maps
 * to is a statement about Nuhas's catalogue, and getting it wrong misprices
 * every future line containing it.
 */
export function TeachTerm({
  action,
  phrase,
  reference,
  canTeach,
}: {
  readonly action: (p: ActionResult | null, f: FormData) => Promise<ActionResult>;
  readonly phrase: string;
  readonly reference: string;
  readonly canTeach: boolean;
}) {
  const [state, submit, pending] = useActionState(action, {});

  if (state.ok !== undefined) {
    return (
      <p role="status" style={{ ...note, color: 'var(--color-status-exact)' }}>
        {state.ok}
      </p>
    );
  }

  return (
    <form
      action={submit}
      style={{
        border: '1px solid var(--color-line-hairline)',
        borderRadius: 'var(--radius-sm)',
        padding: 12,
      }}
    >
      <input type="hidden" name="phrase" value={phrase} />
      <input type="hidden" name="reference" value={reference} />

      <div className="flex items-baseline gap-2">
        <span className="numeric" style={{ color: 'var(--color-status-manual)' }}>
          {phrase}
        </span>
        <span style={note}>is not in the dictionary.</span>
      </div>

      {!canTeach ? (
        <p className="mt-2" style={note}>
          Only the Rate Owner can answer this — what a customer&rsquo;s word maps
          to is a statement about the catalogue, and every future job depends on
          it. Price the affected lines by hand for now, or ask them.
        </p>
      ) : (
        <>
          <div className="mt-3 flex gap-3">
            <label className="flex flex-1 flex-col gap-1">
              <span className="label">It means</span>
              <input
                name="canonical"
                placeholder="PVC"
                required
                className="numeric"
                style={input}
              />
            </label>
            <label className="flex flex-col gap-1" style={{ width: 140 }}>
              <span className="label">On the axis</span>
              <select name="axis" defaultValue="sheath" style={input}>
                {AXES.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="mt-3 flex flex-col gap-1">
            <span className="label">Why</span>
            <input
              name="reason"
              placeholder="How this customer writes LSOH sheathing"
              required
              style={input}
            />
          </label>

          {/* The blast radius, stated before the action rather than after. */}
          <p className="mt-2" style={note}>
            This teaches the app permanently. Every enquiry containing{' '}
            <span className="numeric">{phrase}</span> will read it this way from
            now on, including ones already open.
          </p>

          {state.error !== undefined ? (
            <p role="alert" className="mt-2" style={{ ...note, color: 'var(--color-status-manual)' }}>
              {state.error}
            </p>
          ) : null}

          <button type="submit" disabled={pending} style={primary(pending)}>
            {pending ? 'Teaching…' : 'Add to the dictionary'}
          </button>
        </>
      )}
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
  maxWidth: 640,
};

const primary = (pending: boolean): React.CSSProperties => ({
  marginTop: 12,
  backgroundColor: pending ? 'var(--color-surface-raised)' : 'var(--color-copper)',
  color: pending ? 'var(--color-ink-tertiary)' : 'var(--color-ink-on-copper)',
  borderRadius: 'var(--radius-md)',
  padding: '6px 14px',
  fontWeight: 550,
  minHeight: 'var(--row-height)',
});
