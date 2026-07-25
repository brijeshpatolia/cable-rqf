'use client';

import { useActionState, useMemo, useState } from 'react';
import type { ActionResult } from '@/app/rates/actions';

type Action = (p: ActionResult | null, f: FormData) => Promise<ActionResult>;

export interface MasterRow {
  readonly kind: 'material' | 'machine';
  readonly code: string;
  readonly description: string;
  readonly uom: string;
  readonly rate: string;
  readonly lmeLinked: boolean;
  readonly drawingPremium: string | null;
}

/**
 * The raw material master, editable.
 *
 * Before this the Rate Desk could change what a material *costs* but not what
 * the master *holds* — no new codes, no correcting a description, no marking a
 * code as tracking copper. That was a spreadsheet job, which meant the app's
 * master and the real one drifted apart the first time a supplier line
 * arrived.
 *
 * One panel with a code picker rather than an edit control on all 167 rows:
 * the table is already long enough to need virtualising, and 167 forms would
 * make that worse while helping nobody. The picker is the whole master.
 *
 * **Amending is not a way to change a rate.** The rate box is deliberately
 * absent from the amend form — a price moves by superseding, which states its
 * own reason and keeps the old value readable. Letting a rate ride in on a
 * description change would put a price move somewhere nobody would look for it.
 */
export function MasterEditor({
  createAction,
  amendAction,
  supersedeAction,
  rows,
}: {
  readonly createAction: Action;
  readonly amendAction: Action;
  readonly supersedeAction: Action;
  readonly rows: readonly MasterRow[];
}) {
  const [tab, setTab] = useState<'edit' | 'add'>('edit');
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState(rows[0]?.code ?? '');

  const matching = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (f === '') return rows.slice(0, 200);
    return rows
      .filter(
        (r) =>
          r.code.toLowerCase().includes(f) || r.description.toLowerCase().includes(f),
      )
      .slice(0, 200);
  }, [rows, filter]);

  /**
   * What the form actually edits — always what the picker is showing.
   *
   * Storing the selection and reading it back independently of the filter was
   * a real hazard, and the browser caught it doing exactly what it looks like
   * it would: filtering to a single code left `selected` pointing at the row
   * that happened to be first before the filter, so the screen showed one
   * material and the form amended another. On a master that every bill of
   * materials points at, that is silent corruption.
   *
   * Falling back to the head of the *filtered* list means the two cannot
   * disagree.
   */
  const current =
    matching.find((r) => r.code === selected) ?? matching[0];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        <Tab active={tab === 'edit'} onClick={() => setTab('edit')} label="Edit a code" />
        <Tab active={tab === 'add'} onClick={() => setTab('add')} label="Add a code" />
      </div>

      {tab === 'edit' ? (
        <>
          <label className="flex flex-col gap-1">
            <span className="label">Find a code</span>
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="CC1F, drum, armour wire…"
              style={input}
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="label">
              Code
              {matching.length === rows.length
                ? ` — ${rows.length} in the master`
                : ` — ${matching.length} of ${rows.length}`}
            </span>
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              className="numeric"
              style={input}
            >
              {matching.map((r) => (
                <option key={`${r.kind}-${r.code}`} value={r.code}>
                  {r.code} · {r.description.slice(0, 56)}
                </option>
              ))}
            </select>
          </label>

          {current === undefined ? (
            <p style={note}>Nothing matches that.</p>
          ) : (
            <>
              <Amend key={`amend-${current.code}`} action={amendAction} row={current} />
              <Supersede
                key={`rate-${current.code}`}
                action={supersedeAction}
                row={current}
              />
            </>
          )}
        </>
      ) : (
        <Create action={createAction} />
      )}
    </div>
  );
}

/** The master fields — what a code *is*. Never its rate. */
function Amend({ action, row }: { readonly action: Action; readonly row: MasterRow }) {
  const [state, submit, pending] = useActionState(action, {});
  const [linked, setLinked] = useState(row.lmeLinked);

  return (
    <form action={submit} className="flex flex-col gap-3">
      <input type="hidden" name="kind" value={row.kind} />
      <input type="hidden" name="code" value={row.code} />

      <span className="label">What this code is</span>

      <label className="flex flex-col gap-1">
        <span className="label">Description</span>
        <input name="description" defaultValue={row.description} required style={input} />
      </label>

      <div className="flex gap-3">
        <label className="flex flex-col gap-1" style={{ width: 110 }}>
          <span className="label">Unit</span>
          <input
            name="uom"
            defaultValue={row.uom}
            disabled={row.kind === 'machine'}
            className="numeric"
            style={input}
          />
        </label>

        {row.kind === 'material' ? (
          <label className="flex flex-1 flex-col gap-1">
            <span className="label">Prices off copper</span>
            <span className="flex items-center gap-2" style={{ minHeight: 'var(--row-height)' }}>
              <input
                type="checkbox"
                name="lmeLinked"
                defaultChecked={row.lmeLinked}
                onChange={(e) => setLinked(e.target.checked)}
              />
              <span style={note}>LME-linked</span>
            </span>
          </label>
        ) : null}
      </div>

      {linked ? (
        <label className="flex flex-col gap-1">
          <span className="label">Drawing premium (OMR/kg)</span>
          <input
            name="premium"
            defaultValue={row.drawingPremium ?? ''}
            inputMode="decimal"
            required
            className="numeric"
            style={input}
          />
        </label>
      ) : null}

      <label className="flex flex-col gap-1">
        <span className="label">Reason</span>
        <input
          name="reason"
          placeholder="Supplier renamed the grade"
          required
          style={input}
        />
      </label>

      {/* The consequence, before the action. */}
      <p style={note}>
        {linked === row.lmeLinked
          ? 'The rate is carried forward unchanged — an amendment says what a code is, never what it costs.'
          : linked
            ? 'Linking this to the LME changes how every product containing it reprices. The stored rate stops being used; copper plus the premium takes over.'
            : 'Unlinking this from the LME means it stops tracking copper and holds its stored rate instead.'}
      </p>

      <Outcome state={state} />

      <button type="submit" disabled={pending} style={quiet}>
        {pending ? 'Amending…' : 'Amend the master'}
      </button>
    </form>
  );
}

/** The rate itself, superseded — the existing path, now reachable for any code. */
function Supersede({ action, row }: { readonly action: Action; readonly row: MasterRow }) {
  const [state, submit, pending] = useActionState(action, {});

  return (
    <form
      action={submit}
      className="flex flex-col gap-3"
      style={{ borderTop: '1px solid var(--color-line-hairline)', paddingTop: 14 }}
    >
      <input type="hidden" name="kind" value={row.kind} />
      <input type="hidden" name="code" value={row.code} />

      <span className="label">What it costs</span>

      <div className="flex gap-3">
        <label className="flex flex-1 flex-col gap-1">
          <span className="label">
            {row.lmeLinked ? 'Rate (derived from copper)' : `Rate (OMR/${row.uom})`}
          </span>
          <input
            name="value"
            defaultValue={row.rate}
            inputMode="decimal"
            readOnly={row.lmeLinked}
            required
            className="numeric"
            style={{
              ...input,
              ...(row.lmeLinked
                ? { color: 'var(--color-ink-tertiary)', cursor: 'not-allowed' }
                : {}),
            }}
          />
        </label>

        {row.lmeLinked ? (
          <label className="flex flex-1 flex-col gap-1">
            <span className="label">Drawing premium</span>
            <input
              name="premium"
              defaultValue={row.drawingPremium ?? ''}
              inputMode="decimal"
              required
              className="numeric"
              style={input}
            />
          </label>
        ) : null}
      </div>

      <label className="flex flex-col gap-1">
        <span className="label">Reason</span>
        <input name="reason" placeholder="Supplier price revision, Q3 contract" required style={input} />
      </label>

      <Outcome state={state} />

      <button type="submit" disabled={pending} style={primary(pending)}>
        {pending ? 'Saving…' : 'Supersede the rate'}
      </button>
    </form>
  );
}

function Create({ action }: { readonly action: Action }) {
  const [state, submit, pending] = useActionState(action, {});
  const [kind, setKind] = useState<'material' | 'machine'>('material');
  const [linked, setLinked] = useState(false);

  return (
    <form action={submit} className="flex flex-col gap-3">
      <div className="flex gap-3">
        <label className="flex flex-col gap-1" style={{ width: 120 }}>
          <span className="label">Kind</span>
          <select
            name="kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as 'material' | 'machine')}
            style={input}
          >
            <option value="material">Material</option>
            <option value="machine">Machine</option>
          </select>
        </label>

        <label className="flex flex-1 flex-col gap-1">
          <span className="label">Code</span>
          <input
            name="code"
            placeholder={kind === 'material' ? 'XSAUINS' : 'EX-90R1'}
            required
            className="numeric"
            style={input}
          />
        </label>
      </div>

      <label className="flex flex-col gap-1">
        <span className="label">{kind === 'material' ? 'Description' : 'Stage'}</span>
        <input
          name="description"
          placeholder={
            kind === 'material'
              ? 'LT XLPE COMPOUND'
              : '90 mm extruder, insulation'
          }
          required
          style={input}
        />
      </label>

      <div className="flex gap-3">
        <label className="flex flex-col gap-1" style={{ width: 110 }}>
          <span className="label">Unit</span>
          <input
            name="uom"
            defaultValue={kind === 'material' ? 'kg' : 'hour'}
            readOnly={kind === 'machine'}
            className="numeric"
            style={input}
          />
        </label>

        <label className="flex flex-1 flex-col gap-1">
          <span className="label">Rate</span>
          <input
            name="value"
            defaultValue={linked ? '0' : ''}
            inputMode="decimal"
            required
            className="numeric"
            style={input}
          />
        </label>
      </div>

      {kind === 'material' ? (
        <>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              name="lmeLinked"
              checked={linked}
              onChange={(e) => setLinked(e.target.checked)}
            />
            <span style={note}>Prices off the LME (a copper code)</span>
          </label>

          {linked ? (
            <label className="flex flex-col gap-1">
              <span className="label">Drawing premium (OMR/kg)</span>
              <input
                name="premium"
                placeholder="0.42"
                inputMode="decimal"
                required
                className="numeric"
                style={input}
              />
              <span style={note}>
                A copper code prices as metal value plus this premium. The rate
                above is ignored for it — a thinner conductor costs more per
                kilogram to draw, and that difference is the premium.
              </span>
            </label>
          ) : null}
        </>
      ) : null}

      <label className="flex flex-col gap-1">
        <span className="label">Reason</span>
        <input name="reason" placeholder="New supplier line added to the master" required style={input} />
      </label>

      <p style={note}>
        The code is stored upper-cased and trimmed, because every bill of
        materials points at it — <span className="numeric">cc1f</span> and{' '}
        <span className="numeric">CC1F</span> naming two materials is invisible
        until a product prices twice.
      </p>

      <Outcome state={state} />

      <button type="submit" disabled={pending} style={primary(pending)}>
        {pending ? 'Adding…' : 'Add to the master'}
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

function Tab({
  active,
  onClick,
  label,
}: {
  readonly active: boolean;
  readonly onClick: () => void;
  readonly label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: 1,
        padding: '5px 10px',
        borderRadius: 'var(--radius-sm)',
        border: `1px solid ${active ? 'var(--color-copper)' : 'var(--color-line-hairline)'}`,
        backgroundColor: active ? 'var(--color-surface-raised)' : 'transparent',
        color: active ? 'var(--color-ink-primary)' : 'var(--color-ink-secondary)',
        fontSize: 'var(--text-body)',
      }}
    >
      {label}
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
};

const quiet: React.CSSProperties = {
  alignSelf: 'flex-start',
  border: '1px solid var(--color-line-strong)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--color-ink-primary)',
  padding: '5px 12px',
  fontSize: 'var(--text-micro)',
  minHeight: 'var(--row-height)',
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
