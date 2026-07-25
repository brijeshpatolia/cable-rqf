'use client';

import { useActionState, useMemo, useState } from 'react';
import type { ActionResult } from '@/app/catalogue/actions';

type Action = (p: ActionResult | null, f: FormData) => Promise<ActionResult>;

export interface CodeOption {
  readonly code: string;
  readonly description: string;
}

export interface DesignRow {
  readonly code: string;
  readonly name: string;
  readonly a: string;
  readonly b: string;
}

export interface DesignValue {
  readonly bom: readonly DesignRow[];
  readonly operations: readonly DesignRow[];
  readonly overheads: readonly DesignRow[];
  readonly tooling: string;
}

/**
 * The bill of materials, editable.
 *
 * Nuhas's third and fourth findings, which are one screen: change how an item
 * code is built, or add a new one. Both were spreadsheet jobs, so the app's
 * library and the real one drifted apart on the first change.
 *
 * The material and machine pickers offer only codes the rate master actually
 * holds. A design pointing at a code with no rate cannot be costed, and it is
 * far better to make that unreachable than to refuse it after the typing.
 *
 * Rows submit as parallel arrays — the plainest thing a repeating fieldset can
 * do, and it survives without JavaScript.
 */
export function DesignEditor({
  action,
  code,
  sourceSheet,
  initial,
  materials,
  machines,
  canEdit,
  revisedBy,
  construction,
}: {
  readonly action: Action;
  readonly code: string;
  readonly sourceSheet: string;
  readonly initial: DesignValue;
  readonly materials: readonly CodeOption[];
  readonly machines: readonly CodeOption[];
  readonly canEdit: boolean;
  readonly revisedBy: string | null;
  /**
   * The construction fields, for a *new* item only.
   *
   * Passed in rather than rendered here, and inside the same form, because
   * construction and design are one submission: an item created with a
   * construction and no design is an item that cannot be costed.
   */
  readonly construction?: React.ReactNode;
}) {
  const [state, submit, pending] = useActionState(action, {});
  const [bom, setBom] = useState<DesignRow[]>([...initial.bom]);
  const [ops, setOps] = useState<DesignRow[]>([...initial.operations]);
  const [overheads, setOverheads] = useState<DesignRow[]>([...initial.overheads]);

  if (!canEdit) {
    return (
      <p style={note}>
        Only the Rate Owner can change a design. A bill of materials decides
        what every future quote for this cable costs.
      </p>
    );
  }

  return (
    <form action={submit} className="flex flex-col gap-5">
      {construction === undefined ? (
        <>
          <input type="hidden" name="code" value={code} />
          <input type="hidden" name="sourceSheet" value={sourceSheet} />
        </>
      ) : (
        construction
      )}

      {revisedBy === null ? null : (
        <p style={{ ...note, color: 'var(--color-status-review)' }}>
          This design has already been revised by {revisedBy}. It no longer
          matches the cost sheet it was imported from, and the parity harness
          excludes it — deliberately, because that is what revising means.
        </p>
      )}

      <Rows
        title="Bill of materials"
        hint="kg per km, before scrap. Scrap is an absolute quantity, never a percentage."
        rows={bom}
        setRows={setBom}
        options={materials}
        names={['bomCode', 'bomName', 'bomConsumption', 'bomScrap']}
        columns={['kg/km', 'Scrap']}
      />

      <Rows
        title="Machine route"
        hint="Hours per km, and the multiplier the stage runs at. A machine may appear twice — drawing then re-drawing is a real route."
        rows={ops}
        setRows={setOps}
        options={machines}
        names={['opCode', 'opName', 'opHours', 'opCores']}
        columns={['Hours/km', '×']}
      />

      <Rows
        title="Overheads"
        hint="OMR per km, absorbed."
        rows={overheads}
        setRows={setOverheads}
        options={[]}
        names={['ohKey', 'ohName', 'ohAmount', '']}
        columns={['OMR/km']}
      />

      <label className="flex flex-col gap-1" style={{ maxWidth: 220 }}>
        <span className="label">Tooling (OMR/km)</span>
        <input
          name="tooling"
          defaultValue={initial.tooling}
          inputMode="decimal"
          className="numeric"
          style={input}
        />
        <span style={note}>
          Its own roll-up component, not one of the overhead lines: cost/km is
          materials + operations + overheads + tooling.
        </span>
      </label>

      <label className="flex flex-col gap-1">
        <span className="label">
          {construction === undefined ? 'Why this design changed' : 'Why this item is being added'}
        </span>
        <input
          name="reason"
          placeholder={
            construction === undefined
              ? 'Supplier changed the XLPE grade; consumption re-measured'
              : 'Won a 33 kV build; adding the item code'
          }
          required
          style={input}
        />
      </label>

      <p style={note}>
        {construction === undefined
          ? `Saving changes what every quote from now on costs for ${code}. Quotes already struck keep the design they were costed on — each freezes its whole cost build-up at approval, so a revision can never rewrite what a customer was told.`
          : 'Once saved, this item matches, prices and quotes like any imported one. Its construction becomes fixed; only the design can change after this.'}
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

      <button type="submit" disabled={pending} style={primary(pending)}>
        {pending ? 'Saving…' : construction === undefined ? 'Save the design' : 'Create the item'}
      </button>
    </form>
  );
}

function Rows({
  title,
  hint,
  rows,
  setRows,
  options,
  names,
  columns,
}: {
  readonly title: string;
  readonly hint: string;
  readonly rows: readonly DesignRow[];
  readonly setRows: (rows: DesignRow[]) => void;
  readonly options: readonly CodeOption[];
  readonly names: readonly [string, string, string, string];
  readonly columns: readonly string[];
}) {
  const [codeName, nameName, aName, bName] = names;
  const byCode = useMemo(
    () => new Map(options.map((o) => [o.code, o.description])),
    [options],
  );

  const update = (i: number, patch: Partial<DesignRow>) =>
    setRows(rows.map((r, j) => (i === j ? { ...r, ...patch } : r)));

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="label">
          {title} — {rows.length} line{rows.length === 1 ? '' : 's'}
        </span>
        <button
          type="button"
          onClick={() => setRows([...rows, { code: '', name: '', a: '', b: '' }])}
          style={quiet}
        >
          Add a line
        </button>
      </div>
      <p style={{ ...note, marginTop: 4 }}>{hint}</p>

      <div className="mt-2 flex flex-col">
        {rows.map((row, i) => (
          <div
            key={i}
            className="flex items-center gap-2"
            style={{ padding: '4px 0', borderTop: '1px solid var(--color-line-hairline)' }}
          >
            {options.length > 0 ? (
              <select
                name={codeName}
                value={row.code}
                onChange={(e) =>
                  update(i, {
                    code: e.target.value,
                    name: byCode.get(e.target.value) ?? row.name,
                  })
                }
                className="numeric"
                style={{ ...input, flex: 1 }}
              >
                <option value="">— choose a code —</option>
                {options.map((o) => (
                  <option key={o.code} value={o.code}>
                    {o.code} · {o.description.slice(0, 44)}
                  </option>
                ))}
              </select>
            ) : (
              <input
                name={codeName}
                value={row.code}
                onChange={(e) => update(i, { code: e.target.value, name: e.target.value })}
                placeholder="Overhead name"
                style={{ ...input, flex: 1 }}
              />
            )}

            <input type="hidden" name={nameName} value={row.name} />

            <input
              name={aName}
              value={row.a}
              onChange={(e) => update(i, { a: e.target.value })}
              placeholder={columns[0]}
              inputMode="decimal"
              className="numeric"
              style={{ ...input, width: 110 }}
            />

            {columns[1] !== undefined ? (
              <input
                name={bName}
                value={row.b}
                onChange={(e) => update(i, { b: e.target.value })}
                placeholder={columns[1]}
                inputMode="decimal"
                className="numeric"
                style={{ ...input, width: 90 }}
              />
            ) : null}

            <button
              type="button"
              onClick={() => setRows(rows.filter((_, j) => j !== i))}
              title="Remove this line"
              style={{ ...quiet, padding: '4px 9px' }}
            >
              ×
            </button>
          </div>
        ))}

        {rows.length === 0 ? (
          <p style={{ ...note, paddingTop: 6 }}>Nothing here yet.</p>
        ) : null}
      </div>
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
  padding: '7px 16px',
  fontWeight: 550,
  minHeight: 'var(--row-height)',
});
