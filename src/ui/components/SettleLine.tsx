'use client';

import { useActionState, useState } from 'react';
import type { ActionResult } from '@/app/jobs/actions';

/**
 * Where the app asks, and a person answers.
 *
 * The spec's rule is that the app never guesses. This component is the other
 * half of that rule: having refused to guess, it has to make answering fast,
 * and it has to make the answer *stick* — recorded, attributed, and carried
 * onto the quote.
 *
 * Two ways to answer, in the order an engineer should prefer them:
 *
 *  1. **Name the product.** The engine then costs it normally, so the line
 *     stays explainable down to the kilogram. This is the better answer and it
 *     is offered first.
 *  2. **Set the rate by hand.** Sometimes there is no product and judgement is
 *     all there is. The line then carries no build-up, and the app says so
 *     everywhere rather than inventing one.
 *
 * A reason is required either way, by this form, by the module behind it, and
 * by a CHECK constraint in the database. Three times, because it is the only
 * thing that makes a hand price accountable eight months later.
 */

export interface Nearest {
  readonly code: string;
  readonly sourceSheet: string;
  readonly designation: string;
  readonly differs: string;
}

type Action = (p: ActionResult | null, f: FormData) => Promise<ActionResult>;

export function SettleLine({
  action,
  undoAction,
  reference,
  position,
  nearest,
  current,
  canDecide,
  matched,
}: {
  readonly action: Action;
  readonly undoAction: Action;
  readonly reference: string;
  readonly position: number;
  /** The costed products closest to what was asked for. */
  readonly nearest: readonly Nearest[];
  /** True when the app already settled this line and priced it. */
  readonly matched: boolean;
  /** What was already decided, if anything. */
  readonly current: {
    readonly rate: string | null;
    readonly productCode: string | null;
    readonly reason: string;
    readonly by: string;
  } | null;
  readonly canDecide: boolean;
}) {
  const [state, submit, pending] = useActionState(action, {});
  const [, undo, undoing] = useActionState(undoAction, {});

  /**
   * Naming a product is only on the table when there is a product to name.
   * A line the app already matched has one; an unmatched line has whatever the
   * matcher could find nearby; a line outside the library entirely has none,
   * and offering the choice there would be an empty gesture.
   */
  const canChooseProduct = nearest.length > 0;

  const [mode, setMode] = useState<'product' | 'rate'>(
    canChooseProduct && current?.rate == null ? 'product' : 'rate',
  );
  const [chosen, setChosen] = useState(current?.productCode ?? nearest[0]?.code ?? '');

  if (!canDecide) {
    return (
      <p style={note}>
        Only an engineer can settle a line. Ask one to look at this, or sign in
        with an engineer account.
      </p>
    );
  }

  const sheetOf = (code: string) =>
    nearest.find((n) => n.code === code)?.sourceSheet ?? '';

  return (
    <div className="mt-3" style={{ borderTop: '1px solid var(--color-line-hairline)', paddingTop: 12 }}>
      {current !== null ? (
        <form action={undo} className="mb-3 flex items-baseline gap-3">
          <input type="hidden" name="reference" value={reference} />
          <input type="hidden" name="position" value={position} />
          <span style={{ ...note, flex: 1 }}>
            Settled by <strong style={{ color: 'var(--color-ink-primary)' }}>{current.by}</strong>
            {current.rate !== null ? (
              <>
                {' '}at <span className="numeric">{current.rate}</span> OMR/m
              </>
            ) : null}
            {current.productCode !== null ? (
              <>
                {' '}as <span className="numeric">{current.productCode}</span>
              </>
            ) : null}
            {' — '}
            {current.reason}
          </span>
          <button type="submit" disabled={undoing} style={quietButton}>
            {undoing ? 'Reopening…' : 'Reopen'}
          </button>
        </form>
      ) : null}

      <form action={submit} className="flex flex-col gap-3">
        <input type="hidden" name="reference" value={reference} />
        <input type="hidden" name="position" value={position} />

        {canChooseProduct ? (
          <div className="flex gap-2">
            <Choice
              active={mode === 'product'}
              onClick={() => setMode('product')}
              label={matched ? 'Price it as another product' : 'Price it as a product'}
              hint="Keeps the full build-up"
            />
            <Choice
              active={mode === 'rate'}
              onClick={() => setMode('rate')}
              label={matched ? 'Override the price' : 'Set the rate by hand'}
              hint={matched ? 'Keeps the build-up, replaces the price' : 'No build-up — judgement only'}
            />
          </div>
        ) : (
          <p style={note}>
            Nothing in the library is close enough to price this as, so the only
            answer available is a rate. Add the cable to the catalogue first if
            you would rather it were costed properly.
          </p>
        )}

        {mode === 'product' && canChooseProduct ? (
          <>
              <label className="flex flex-col gap-1">
                <span className="label">Price it as</span>
                <select
                  name="productCode"
                  value={chosen}
                  onChange={(e) => setChosen(e.target.value)}
                  style={input}
                >
                  {nearest.map((n) => (
                    <option key={`${n.code}-${n.sourceSheet}`} value={n.code}>
                      {n.code} — {n.designation}
                    </option>
                  ))}
                </select>
              </label>
            <input type="hidden" name="sourceSheet" value={sheetOf(chosen)} />
            <p style={note}>
              Differs on{' '}
              {nearest.find((n) => n.code === chosen)?.differs || 'nothing'}. The
              engine costs it from the library, so the line keeps its full
              build-up and the swap is named on the quote.
            </p>
          </>
        ) : (
          <label className="flex flex-col gap-1">
            <span className="label">Unit rate (OMR/m)</span>
            <input
              name="rate"
              // The echo, not the stored value: a refused submission must not
              // cost the engineer what they typed.
              defaultValue={state.submitted?.['rate'] ?? current?.rate ?? ''}
              inputMode="decimal"
              required
              className="numeric"
              style={input}
            />
            <span style={note}>
              {matched
                ? 'The cost build-up below stays as the engine computed it. This replaces the price only, so the gap between cost and price stays visible.'
                : 'This line will carry no cost build-up. The quote, the PDF and the workbook will all say it was priced to order rather than showing materials nobody costed.'}
            </span>
          </label>
        )}

        <label className="flex flex-col gap-1">
          <span className="label">Why</span>
          <input
            name="reason"
            defaultValue={state.submitted?.['reason'] ?? current?.reason ?? ''}
            placeholder="Customer confirmed 3-core is acceptable"
            required
            style={input}
          />
        </label>

        {state.error !== undefined ? (
          <p role="alert" style={{ ...note, color: 'var(--color-status-manual)' }}>
            {state.error}
          </p>
        ) : null}
        {state.ok !== undefined ? (
          <p role="status" style={{ ...note, color: 'var(--color-status-exact)' }}>
            {state.ok}
          </p>
        ) : null}

        <button type="submit" disabled={pending} style={primary(pending)}>
          {pending ? 'Saving…' : current === null ? 'Settle this line' : 'Change the decision'}
        </button>
      </form>
    </div>
  );
}

function Choice({
  active,
  onClick,
  label,
  hint,
}: {
  readonly active: boolean;
  readonly onClick: () => void;
  readonly label: string;
  readonly hint: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: 1,
        textAlign: 'left',
        padding: '7px 10px',
        borderRadius: 'var(--radius-sm)',
        border: `1px solid ${active ? 'var(--color-copper)' : 'var(--color-line-hairline)'}`,
        backgroundColor: active ? 'var(--color-surface-raised)' : 'transparent',
        color: active ? 'var(--color-ink-primary)' : 'var(--color-ink-secondary)',
      }}
    >
      <span style={{ display: 'block', fontSize: 'var(--text-body)' }}>{label}</span>
      <span
        style={{
          display: 'block',
          color: 'var(--color-ink-tertiary)',
          fontSize: 'var(--text-micro)',
        }}
      >
        {hint}
      </span>
    </button>
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

const quietButton: React.CSSProperties = {
  border: '1px solid var(--color-line-strong)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--color-ink-secondary)',
  padding: '3px 10px',
  fontSize: 'var(--text-micro)',
};

const primary = (pending: boolean): React.CSSProperties => ({
  alignSelf: 'flex-start',
  backgroundColor: pending ? 'var(--color-surface-raised)' : 'var(--color-copper)',
  color: pending ? 'var(--color-ink-tertiary)' : 'var(--color-ink-on-copper)',
  borderRadius: 'var(--radius-md)',
  padding: '6px 14px',
  fontWeight: 550,
  minHeight: 'var(--row-height)',
});
