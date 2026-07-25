'use client';

import { useState } from 'react';
import type { ActionResult } from '@/app/catalogue/actions';
import { DesignEditor, type CodeOption } from './DesignEditor';

/**
 * A new item code: construction, then design.
 *
 * The construction fields are exactly the nine the matcher compares. They are
 * set here and nowhere else — after this the item is revisable but its
 * construction is fixed, so a cable cannot quietly become a different cable and
 * reprice every enquiry that had matched it.
 *
 * The construction inputs live *inside* the design form rather than beside it,
 * because they are one submission. Two forms would mean an item could be
 * created with a construction and no design, which is an item that cannot be
 * costed.
 */
export function NewProduct({
  action,
  materials,
  machines,
  canEdit,
}: {
  readonly action: (p: ActionResult | null, f: FormData) => Promise<ActionResult>;
  readonly materials: readonly CodeOption[];
  readonly machines: readonly CodeOption[];
  readonly canEdit: boolean;
}) {
  const [cores, setCores] = useState('3');
  const [size, setSize] = useState('50');
  const [family, setFamily] = useState('MV CABLE');
  const [spec, setSpec] = useState({
    conductor: 'Cu',
    insulation: 'XLPE',
    screen: '',
    armour: 'SWA',
    sheath: 'PVC',
    voltage: '',
    standard: '',
  });

  if (!canEdit) {
    return (
      <p style={note}>
        Only the Rate Owner can add an item code. Everything the app quotes is
        priced from this library.
      </p>
    );
  }

  const set = (k: keyof typeof spec) => (v: string) => setSpec({ ...spec, [k]: v });

  return (
    <DesignEditor
      action={action}
      code=""
      sourceSheet=""
      initial={{ bom: [], operations: [], overheads: [], tooling: '0' }}
      materials={materials}
      machines={machines}
      canEdit
      revisedBy={null}
      construction={
        <div className="flex flex-col gap-3">
          <span className="label">Construction</span>

          <div className="flex flex-wrap gap-3">
            <Field label="Item code" width={190}>
              <input name="code" placeholder="MCM3XLBJ5MVWVKNN" required className="numeric" style={input} />
            </Field>
            <Field label="Family" width={160}>
              <input
                name="family"
                value={family}
                onChange={(e) => setFamily(e.target.value)}
                style={input}
              />
            </Field>
            <Field label="Cores" width={90}>
              <input
                name="cores"
                value={cores}
                onChange={(e) => setCores(e.target.value)}
                inputMode="numeric"
                required
                className="numeric"
                style={input}
              />
            </Field>
            <Field label="Size (mm²)" width={110}>
              <input
                name="sizeMm2"
                value={size}
                onChange={(e) => setSize(e.target.value)}
                inputMode="decimal"
                required
                className="numeric"
                style={input}
              />
            </Field>
          </div>

          <div className="flex flex-wrap gap-3">
            {(
              [
                ['conductor', 'Conductor', 'Cu', true],
                ['insulation', 'Insulation', 'XLPE', true],
                ['screen', 'Screen', 'CTS (blank if none)', false],
                ['armour', 'Armour', 'SWA (blank if none)', false],
                ['sheath', 'Sheath', 'PVC', true],
                ['voltage', 'Voltage', '33kV', true],
                ['standard', 'Standard', 'IEC 60502-2', false],
              ] as const
            ).map(([key, label, placeholder, required]) => (
              <Field key={key} label={label} width={150}>
                <input
                  name={key}
                  value={spec[key]}
                  onChange={(e) => set(key)(e.target.value)}
                  placeholder={placeholder}
                  required={required}
                  className="numeric"
                  style={input}
                />
              </Field>
            ))}
          </div>

          <Field label="Designation (optional)">
            <input
              name="designation"
              placeholder="Left blank, one is composed from the construction above"
              style={input}
            />
          </Field>

          <p style={note}>
            Conductor, insulation, sheath and voltage are among the nine fields
            the matcher compares — a cable missing one would never match an
            enquiry, so they are required. Screen and armour are legitimately
            blank on an unscreened or unarmoured cable.
          </p>
        </div>
      }
    />
  );
}

function Field({
  label,
  width,
  children,
}: {
  readonly label: string;
  readonly width?: number;
  readonly children: React.ReactNode;
}) {
  return (
    <label
      className="flex flex-col gap-1"
      style={width === undefined ? { flex: 1 } : { width }}
    >
      <span className="label">{label}</span>
      {children}
    </label>
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
