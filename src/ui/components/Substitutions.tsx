'use client';

import { useActionState } from 'react';
import type { ActionResult } from '@/app/jobs/actions';

type Action = (p: ActionResult | null, f: FormData) => Promise<ActionResult>;

export interface RuleView {
  readonly id: string;
  readonly axis: string;
  readonly axisName: string;
  readonly from: string;
  readonly to: string;
  readonly rationale: string;
  readonly declaredBy: string | null;
  readonly declaredAt: string;
  readonly retired: boolean;
}

const AXES = [
  ['insulation', 'Insulation'],
  ['screen', 'Screen'],
  ['armour', 'Armour'],
  ['sheath', 'Sheath'],
  ['standard', 'Standard'],
] as const;

/**
 * The allowlist.
 *
 * Cores, size and voltage are absent from the axis list on purpose: they are
 * core parameters, and a "substitution" on one of them is a different cable,
 * not a substitution. The matcher refuses them anyway — this just declines to
 * offer the mistake.
 */
export function Substitutions({
  declareAction,
  retireAction,
  rules,
  canEdit,
}: {
  readonly declareAction: Action;
  readonly retireAction: Action;
  readonly rules: readonly RuleView[];
  readonly canEdit: boolean;
}) {
  const [state, declare, declaring] = useActionState(declareAction, {});
  const [retired, retire, retiring] = useActionState(retireAction, {});

  const inForce = rules.filter((r) => !r.retired);

  return (
    <div>
      {rules.length === 0 ? (
        <p style={note}>
          Nothing is substitutable yet, so no line can tier <em>Close</em>. That
          is the intended starting point: a permissive allowlist is how wrong
          prices get out. Each rule below is a judgement about what can safely
          be built, and it is shown to the engineer on every line priced
          through it.
        </p>
      ) : (
        <div className="flex flex-col">
          {rules.map((r) => (
            <div
              key={r.id}
              className="flex items-baseline gap-3"
              style={{
                padding: '8px 0',
                borderBottom: '1px solid var(--color-line-hairline)',
                opacity: r.retired ? 0.55 : 1,
              }}
            >
              <span className="numeric" style={{ width: 210, textAlign: 'left' }}>
                {r.from} → {r.to}
              </span>
              <span
                style={{
                  width: 90,
                  color: 'var(--color-ink-tertiary)',
                  fontSize: 'var(--text-micro)',
                }}
              >
                {r.axisName}
              </span>
              <span className="min-w-0 flex-1" style={note}>
                {r.rationale}
                <span style={{ color: 'var(--color-ink-tertiary)' }}>
                  {' '}— {r.declaredBy ?? 'unknown'}, {r.declaredAt}
                  {r.retired ? ' · withdrawn' : ''}
                </span>
              </span>

              {canEdit && !r.retired ? (
                <form action={retire} className="flex items-baseline gap-2">
                  <input type="hidden" name="id" value={r.id} />
                  <input
                    name="reason"
                    placeholder="Why withdraw"
                    required
                    style={{ ...input, width: 170 }}
                  />
                  <button type="submit" disabled={retiring} style={quiet}>
                    Withdraw
                  </button>
                </form>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {retired.ok !== undefined ? (
        <p role="status" className="mt-3" style={{ ...note, color: 'var(--color-status-exact)' }}>
          {retired.ok}
        </p>
      ) : null}

      {canEdit ? (
        <form action={declare} className="mt-5 flex flex-col gap-3">
          <span className="label">Declare a substitution safe</span>

          <div className="flex gap-3">
            <label className="flex flex-col gap-1" style={{ width: 140 }}>
              <span className="label">Axis</span>
              <select name="axis" defaultValue="sheath" style={input}>
                {AXES.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            {/*
              The example runs LSOH → PVC, and the direction is the whole
              point of it.

              A rule prices on what the *library* holds, so these placeholders
              read as "a customer asking for PVC may be given LSOH". The
              example used to be the other way round — hold PVC, satisfy a
              request for LSOH — which is not a commercial compromise but a
              failed specification: LSOH is specified where a fire would trap
              people, because PVC burns to dense smoke and hydrogen chloride.
              Its own rationale text described the safe direction while the
              fields described the unsafe one.

              Placeholders are read as instructions by anyone in a hurry, and
              this form's entire purpose is stopping the wrong cable being
              quoted. So the example shows the substitution that is actually
              safe: the better material standing in for the lesser one.
            */}
            <label className="flex flex-1 flex-col gap-1">
              <span className="label">Library holds</span>
              <input name="from" placeholder="LSOH" required className="numeric" style={input} />
            </label>
            <label className="flex flex-1 flex-col gap-1">
              <span className="label">Customer asks for</span>
              <input name="to" placeholder="PVC" required className="numeric" style={input} />
            </label>
          </div>

          <label className="flex flex-col gap-1">
            <span className="label">Why this is safe</span>
            <input
              name="rationale"
              placeholder="LSOH exceeds PVC on LV sheathing — same wall thickness, no spec lost"
              required
              style={input}
            />
          </label>

          {/* The consequence, before the action. */}
          <p style={note}>
            Every future line differing only on this axis will be priced
            automatically on the library&rsquo;s material and flagged amber. The
            reason above is what the engineer sees when deciding whether to
            trust it.
          </p>

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

          <button type="submit" disabled={declaring} style={primary(declaring)}>
            {declaring ? 'Declaring…' : 'Allow this substitution'}
          </button>
        </form>
      ) : inForce.length === 0 ? null : (
        <p className="mt-4" style={note}>
          Only the Rate Owner can change this list.
        </p>
      )}
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
  maxWidth: 680,
};

const quiet: React.CSSProperties = {
  border: '1px solid var(--color-line-strong)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--color-ink-secondary)',
  padding: '3px 10px',
  fontSize: 'var(--text-micro)',
  whiteSpace: 'nowrap',
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
