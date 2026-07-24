import { formatInstant, formatDate, formatNumber } from '@/core/format';
import type { CostBreakdown } from '@/modules/costing/types';
import { ExpandableRow, Provenance, StrikeFooter } from './ExpandableRow';
import { NumericCell } from './NumericCell';

/**
 * The signature, rendered.
 *
 * This is a *render of the engine's tree*, never a second computation — which
 * is why the summary and the detail can never disagree. It ships with the row
 * from the server, so expansion has no loading state.
 */
export function CostBreakdownView({
  breakdown,
}: {
  readonly breakdown: CostBreakdown;
}) {
  const b = breakdown;

  return (
    <div>
      {/* ── Materials ─────────────────────────────────────────────── */}
      <ExpandableRow
        depth={0}
        raised={false}
        summary={
          <SectionSummary
            label="Materials"
            value={<NumericCell value={b.materialsSubtotal} kind="costPerKm" />}
          />
        }
      >
        <table className="w-full">
          <thead>
            <tr>
              <Th align="left">Material</Th>
              <Th>kg/km</Th>
              <Th>Scrap</Th>
              <Th>Effective</Th>
              <Th>Rate</Th>
              <Th>Cost</Th>
            </tr>
          </thead>
          <tbody>
            {b.materials.map((m) => (
              <tr key={m.materialKey}>
                <Td align="left">
                  <div>{m.materialName}</div>
                  <Provenance>
                    {m.source.table} #{m.source.rateId} · effective{' '}
                    {formatDate(m.source.effectiveFrom)}
                    {m.source.lmeLinked ? ' · LME-linked' : ''}
                  </Provenance>
                </Td>
                <Td>
                  <NumericCell value={m.consumption} kind="weight" />
                </Td>
                <Td>
                  <NumericCell value={m.scrapPercent} kind="percent" unit="%" />
                </Td>
                <Td>
                  <NumericCell value={m.effectiveConsumption} kind="weight" />
                </Td>
                <Td>
                  <NumericCell value={m.rate} kind="unitRate" />
                </Td>
                <Td>
                  <NumericCell value={m.cost} kind="costPerKm" />
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </ExpandableRow>

      {/* ── Machine operations ────────────────────────────────────── */}
      <ExpandableRow
        depth={0}
        raised={false}
        summary={
          <SectionSummary
            label="Machine operations"
            value={<NumericCell value={b.operationsSubtotal} kind="costPerKm" />}
          />
        }
      >
        <table className="w-full">
          <thead>
            <tr>
              <Th align="left">Stage</Th>
              <Th>Hours</Th>
              <Th>Rate</Th>
              <Th>Cost</Th>
            </tr>
          </thead>
          <tbody>
            {b.operations.map((o) => (
              <tr key={o.machineKey}>
                <Td align="left">
                  <div>{o.machineName}</div>
                  <Provenance>
                    {o.source.table} #{o.source.rateId} · effective{' '}
                    {formatDate(o.source.effectiveFrom)}
                  </Provenance>
                </Td>
                <Td>
                  <NumericCell value={o.hours} kind="hours" unit="h" />
                </Td>
                <Td>
                  <NumericCell value={o.rate} kind="unitRate" />
                </Td>
                <Td>
                  <NumericCell value={o.cost} kind="costPerKm" />
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </ExpandableRow>

      {/* ── Overheads ─────────────────────────────────────────────── */}
      <ExpandableRow
        depth={0}
        raised={false}
        summary={
          <SectionSummary
            label="Overheads & tooling"
            value={<NumericCell value={b.overheadsSubtotal} kind="costPerKm" />}
          />
        }
      >
        <table className="w-full">
          <tbody>
            {b.overheads.map((o) => (
              <tr key={o.key}>
                <Td align="left">{o.name}</Td>
                <Td>
                  <NumericCell value={o.cost} kind="costPerKm" />
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </ExpandableRow>

      {/* ── Roll-up ───────────────────────────────────────────────── */}
      <TotalRow
        label="Cost per km"
        value={<NumericCell value={b.costPerKm} kind="costPerKm" unit="OMR/km" weight="strong" />}
      />
      <TotalRow
        label="Cost per metre"
        value={
          <NumericCell value={b.costPerMetre} kind="costPerMetre" unit="OMR/m" weight="strong" />
        }
      />

      <ExpandableRow
        depth={0}
        raised={false}
        summary={
          <SectionSummary
            label={`Commercial — margin ${b.commercial.marginPercent.toFixed(1)}% · drum · packing · freight`}
            value={null}
          />
        }
      >
        <table className="w-full">
          <tbody>
            <tr>
              <Td align="left">Margin</Td>
              <Td>
                <NumericCell value={b.commercial.marginAmount} kind="costPerKm" />
              </Td>
            </tr>
            <tr>
              <Td align="left">Drum</Td>
              <Td>
                <NumericCell value={b.commercial.drumCost} kind="costPerKm" />
              </Td>
            </tr>
            <tr>
              <Td align="left">Packing</Td>
              <Td>
                <NumericCell value={b.commercial.packingCost} kind="costPerKm" />
              </Td>
            </tr>
            <tr>
              <Td align="left">Freight</Td>
              <Td>
                <NumericCell value={b.commercial.freightCost} kind="costPerKm" />
              </Td>
            </tr>
          </tbody>
        </table>
      </ExpandableRow>

      <TotalRow
        label="Unit rate"
        value={<NumericCell value={b.unitRate} kind="unitRate" unit="OMR/m" weight="strong" />}
      />

      <StrikeFooter>
        Struck on LME {formatNumber(b.strike.lme, 2)} · FX {b.strike.fx.toFixed(4)} ·
        copper {b.strike.copperOmrPerKg.toFixed(4)} OMR/kg ·{' '}
        {formatInstant(b.strike.asOf)}
      </StrikeFooter>
    </div>
  );
}

function SectionSummary({
  label,
  value,
}: {
  readonly label: string;
  readonly value: React.ReactNode;
}) {
  return (
    <span className="flex items-baseline justify-between gap-4">
      <span style={{ color: 'var(--color-ink-primary)' }}>{label}</span>
      {value}
    </span>
  );
}

function TotalRow({
  label,
  value,
}: {
  readonly label: string;
  readonly value: React.ReactNode;
}) {
  return (
    <div
      className="flex items-baseline justify-between"
      style={{
        padding: `var(--cell-pad-y) var(--cell-pad-x)`,
        paddingLeft: 'calc(var(--cell-pad-x) + 20px)',
        borderBottom: '1px solid var(--color-line-hairline)',
        minHeight: 'var(--row-height)',
      }}
    >
      <span style={{ color: 'var(--color-ink-secondary)' }}>{label}</span>
      {value}
    </div>
  );
}

function Th({
  children,
  align = 'right',
}: {
  readonly children: React.ReactNode;
  readonly align?: 'left' | 'right';
}) {
  return (
    <th
      className="label"
      style={{ textAlign: align, padding: '4px 8px', fontWeight: 560 }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = 'right',
}: {
  readonly children: React.ReactNode;
  readonly align?: 'left' | 'right';
}) {
  return (
    <td style={{ textAlign: align, padding: '4px 8px', verticalAlign: 'top' }}>
      {children}
    </td>
  );
}
