'use client';

import { useActionState } from 'react';
import type { ActionResult } from '@/app/rates/actions';

/**
 * The two write controls on the Rate Desk.
 *
 * Both follow the same discipline as the rest of the app: the consequence is
 * stated before the action, the result is stated in words afterwards, and a
 * refusal explains itself rather than showing a disabled control with no
 * reason.
 */

type Action = (
  previous: ActionResult | null,
  form: FormData,
) => Promise<ActionResult>;

export function LmeEntry({
  action,
  currentLme,
  currentFx,
  productCount,
}: {
  readonly action: Action;
  readonly currentLme: string;
  readonly currentFx: string;
  readonly productCount: number;
}) {
  const [state, submit, pending] = useActionState(action, {});

  return (
    <form action={submit} className="flex flex-col gap-3">
      <div className="flex gap-3">
        <label className="flex flex-1 flex-col gap-1">
          <span className="label">LME USD/t</span>
          <input
            name="lme"
            defaultValue={currentLme}
            inputMode="decimal"
            required
            className="numeric"
            style={input}
          />
        </label>
        <label className="flex flex-col gap-1" style={{ width: 96 }}>
          <span className="label">FX</span>
          <input
            name="fx"
            defaultValue={currentFx}
            inputMode="decimal"
            required
            className="numeric"
            style={input}
          />
        </label>
      </div>

      {/* The blast radius, stated before the action rather than after it. */}
      <p style={note}>
        Repricing affects every one of the {productCount} products containing
        copper, and flags open quotes struck below the new price. The previous
        tick is kept — the series is never edited.
      </p>

      <Outcome state={state} />

      <button type="submit" disabled={pending} style={primary(pending)}>
        {pending ? 'Repricing…' : 'Enter copper price'}
      </button>
    </form>
  );
}

export function RateEditor({
  action,
  kind,
  code,
  currentValue,
  currentPremium,
  lmeLinked,
}: {
  readonly action: Action;
  readonly kind: 'material' | 'machine';
  readonly code: string;
  readonly currentValue: string;
  readonly currentPremium: string | null;
  readonly lmeLinked: boolean;
}) {
  const [state, submit, pending] = useActionState(action, {});

  return (
    <form action={submit} className="flex flex-col gap-3">
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="code" value={code} />

      <div className="flex gap-3">
        <label className="flex flex-1 flex-col gap-1">
          <span className="label">
            {lmeLinked ? 'Rate (derived)' : 'Rate'}
          </span>
          <input
            name="value"
            defaultValue={currentValue}
            inputMode="decimal"
            readOnly={lmeLinked}
            required
            className="numeric"
            style={{
              ...input,
              ...(lmeLinked
                ? { color: 'var(--color-ink-tertiary)', cursor: 'not-allowed' }
                : {}),
            }}
          />
        </label>

        {lmeLinked ? (
          <label className="flex flex-1 flex-col gap-1">
            <span className="label">Drawing premium</span>
            <input
              name="premium"
              defaultValue={currentPremium ?? ''}
              inputMode="decimal"
              required
              className="numeric"
              style={input}
            />
          </label>
        ) : null}
      </div>

      {lmeLinked ? (
        <p style={note}>
          {code} prices off the LME, so its rate is derived rather than stored.
          The premium is the part that is set here.
        </p>
      ) : null}

      <label className="flex flex-col gap-1">
        <span className="label">Reason</span>
        <input
          name="reason"
          placeholder="Supplier price revision, Q3 contract"
          required
          style={input}
        />
      </label>

      <Outcome state={state} />

      <button type="submit" disabled={pending} style={primary(pending)}>
        {pending ? 'Saving…' : 'Supersede rate'}
      </button>
    </form>
  );
}

function Outcome({ state }: { readonly state: ActionResult }) {
  if (state.error !== undefined) {
    return (
      <p role="alert" style={{ ...note, color: 'var(--color-status-manual)' }}>
        {state.error}
      </p>
    );
  }
  if (state.ok !== undefined) {
    return (
      <p role="status" style={{ ...note, color: 'var(--color-status-exact)' }}>
        {state.ok}
      </p>
    );
  }
  return null;
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

const primary = (pending: boolean): React.CSSProperties => ({
  backgroundColor: pending
    ? 'var(--color-surface-raised)'
    : 'var(--color-copper)',
  color: pending ? 'var(--color-ink-tertiary)' : 'var(--color-ink-on-copper)',
  borderRadius: 'var(--radius-md)',
  padding: '7px 12px',
  fontWeight: 550,
  minHeight: 'var(--row-height)',
});
