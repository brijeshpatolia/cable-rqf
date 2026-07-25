/**
 * Importer — Nuhas_Cost_Master.xlsx → the app's rate and product tables.
 *
 * Run: `pnpm import`
 *
 * The workbook is the consolidation of Nuhas's 99 individual cost sheets. This
 * script turns it into the normalised JSON the app reads, and emits one parity
 * fixture per product carrying the sheet's *own* answer — the number the cost
 * engine must reproduce.
 *
 * The rule this script follows: **every cell is accounted for**. Mapped,
 * ignored by a stated rule, or flagged. It prints that reconciliation at the
 * end, because an import that silently drops rows is how a costing system
 * starts lying (PROJECT_PLAN.md Phase 0, acceptance criterion 4).
 *
 * Numbers are carried through as strings, never as JS numbers, so no float
 * rounding enters between the spreadsheet and the Decimal engine.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as XLSX from 'xlsx';

const WORKBOOK = join(process.cwd(), 'data/Nuhas_Cost_Master.xlsx');
const DATA_OUT = join(process.cwd(), 'src/infra/data');
const FIXTURE_OUT = join(process.cwd(), 'tests/parity/fixtures');

type Row = Record<string, unknown>;

/** Full precision as text. The workbook holds 15 significant digits. */
function num(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return String(v);
  const parsed = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(parsed) ? String(parsed) : null;
}

function required(v: unknown, what: string): string {
  const n = num(v);
  if (n === null) throw new Error(`Expected a number for ${what}, got ${String(v)}`);
  return n;
}

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v).trim();
}

/**
 * Sheets carry a title and a note above the real header. Find the header row
 * by its first column name rather than assuming a fixed offset.
 */
function readTable(wb: XLSX.WorkBook, sheet: string, firstHeader: string): Row[] {
  const ws = wb.Sheets[sheet];
  if (ws === undefined) throw new Error(`Sheet "${sheet}" not found`);

  const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true });
  const headerIndex = grid.findIndex((r) => str(r?.[0]) === firstHeader);
  if (headerIndex < 0) {
    throw new Error(`Header "${firstHeader}" not found in sheet "${sheet}"`);
  }

  const headers = (grid[headerIndex] ?? []).map((h) => str(h));
  return grid
    .slice(headerIndex + 1)
    .filter((r) => r !== undefined && str(r[0]) !== '')
    .map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i]])));
}

// ── Report ──────────────────────────────────────────────────────────────

const report = {
  mapped: {} as Record<string, number>,
  ignored: [] as string[],
  flagged: [] as string[],
};

const count = (what: string, n: number) => {
  report.mapped[what] = n;
};

// ── Read ────────────────────────────────────────────────────────────────

const wb = XLSX.read(readFileSync(WORKBOOK), { type: 'buffer' });

const drivers = readTable(wb, 'Drivers', 'Driver');
const rmRates = readTable(wb, 'RM_Rates', 'RM_Code');
const machineRates = readTable(wb, 'Machine_Rates', 'Machine_Code');
const productRows = readTable(wb, 'Products', 'Product_Code');
const bomRows = readTable(wb, 'BOM', 'Product_Code');
const opRows = readTable(wb, 'Operations', 'Product_Code');
const ohRows = readTable(wb, 'Overheads', 'Product_Code');

// ── Drivers ─────────────────────────────────────────────────────────────

const driverBy = (name: string): string => {
  const row = drivers.find((d) => str(d['Driver']).startsWith(name));
  if (row === undefined) throw new Error(`Driver "${name}" not found`);
  return required(row['Value'], name);
};

const driversOut = {
  lme: driverBy('LME copper'),
  fx: driverBy('OMR per USD'),
  // The workbook holds margin as a fraction (0.15); the app works in percent.
  marginPercent: String(Number(driverBy('Margin on cost')) * 100),
  note: 'Imported from Nuhas_Cost_Master.xlsx. FX and the copper decomposition are stated assumptions pending confirmation.',
};
count('drivers', 3);
report.ignored.push(
  'Drivers: "Scrap treatment" and "Copper metal value" are notes — the first is prose, the second is derived from LME × FX and recomputed by the engine.',
);

// ── Materials ───────────────────────────────────────────────────────────

const materials = rmRates.map((r) => {
  const linked = str(r['LME linked?']).toLowerCase() === 'yes';
  const premium = num(r['Drawing premium (OMR/kg)']);

  if (linked && premium === null) {
    report.flagged.push(
      `RM_Rates ${str(r['RM_Code'])}: marked LME-linked but carries no drawing premium.`,
    );
  }

  return {
    code: str(r['RM_Code']),
    description: str(r['Description']),
    uom: str(r['UOM']),
    lmeLinked: linked,
    drawingPremium: premium,
    rate: required(r['Rate (OMR/unit)'], `rate for ${str(r['RM_Code'])}`),
  };
});
count('materials', materials.length);

const machines = machineRates.map((r) => ({
  code: str(r['Machine_Code']),
  stage: str(r['Stage type']),
  rate: required(r['Rate (OMR/hr)'], `rate for ${str(r['Machine_Code'])}`),
  observations: Number(num(r['Observations']) ?? 0),
  variancePercent: num(r['Variance %']),
}));
count('machines', machines.length);

// ── Products ────────────────────────────────────────────────────────────

/**
 * Two product codes appear twice, once per source sheet, with identical costs.
 * The natural key is therefore (code, sheet), not code — keyed on code alone,
 * one row would silently overwrite the other.
 */
const key = (code: string, sheet: string) => `${code}::${sheet}`;

const groupBy = <T>(rows: T[], code: (r: T) => string, sheet: (r: T) => string) => {
  const out = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(code(r), sheet(r));
    const list = out.get(k);
    if (list === undefined) out.set(k, [r]);
    else list.push(r);
  }
  return out;
};

/**
 * The 8th overhead line, "Cost of tooling", holds the same figure as the
 * Products sheet's own "Tooling /km" column — verified equal for all 99
 * products. The workbook's Overheads /km (C) column excludes it precisely
 * because tooling is a separate term in the roll-up:
 *
 *     cost/km = raw material (A) + operations (B) + overheads (C) + tooling
 *
 * Importing it in both places would count tooling twice. It is dropped from
 * the overhead lines and kept as the product's tooling.
 */
const TOOLING_OVERHEAD_LINE = 'Cost of tooling';

const bomByProduct = groupBy(bomRows, (r) => str(r['Product_Code']), (r) => str(r['Sheet']));
const opsByProduct = groupBy(opRows, (r) => str(r['Product_Code']), (r) => str(r['Sheet']));
const ohByProduct = groupBy(ohRows, (r) => str(r['Product_Code']), (r) => str(r['Sheet']));

// The Products sheet ends with two reconciliation rows that are not products.
const FOOTER_MARKERS = ['TOTALS / CHECK', 'Sum of absolute deltas'];
const isFooter = (code: string) => FOOTER_MARKERS.some((m) => code.startsWith(m));

const footers = productRows.filter((r) => isFooter(str(r['Product_Code'])));
report.ignored.push(
  `Products: ${footers.length} trailing reconciliation rows (${FOOTER_MARKERS.join(', ')}) are checksums, not products.`,
);

const products: unknown[] = [];
const fixtures: unknown[] = [];

for (const r of productRows) {
  const code = str(r['Product_Code']);
  if (isFooter(code)) continue;

  const sheet = str(r['Sheet'] ?? '');
  const k = key(code, sheet);

  // The Products sheet has no Sheet column; match on code across the detail
  // tables and take the sheet from there.
  const bomKeys = [...bomByProduct.keys()].filter((kk) => kk.startsWith(`${code}::`));
  const sourceSheet = sheet !== '' ? sheet : str(bomKeys[0]?.split('::')[1] ?? '');
  const lookup = sheet !== '' ? k : (bomKeys[0] ?? k);

  const bom = bomByProduct.get(lookup) ?? [];
  const ops = opsByProduct.get(lookup) ?? [];
  const overheads = ohByProduct.get(lookup) ?? [];

  if (bom.length === 0) {
    report.flagged.push(`Product ${code}: no BOM lines found — cannot be costed.`);
  }

  // Assert the duplication rather than assuming it. If a sheet ever disagrees,
  // the import must say so rather than quietly dropping a real overhead.
  const toolingLine = overheads.find(
    (o) => str(o['Overhead line']) === TOOLING_OVERHEAD_LINE,
  );
  const toolingColumn = num(r['Tooling /km']) ?? '0';
  if (toolingLine !== undefined) {
    const lineValue = num(toolingLine['Value (OMR/km)']) ?? '0';
    if (Math.abs(Number(lineValue) - Number(toolingColumn)) > 1e-9) {
      report.flagged.push(
        `Product ${code}: overhead "${TOOLING_OVERHEAD_LINE}" (${lineValue}) ` +
          `differs from the Tooling /km column (${toolingColumn}). Not safely de-duplicable.`,
      );
    }
  }

  // A duplicated code is consumed one sheet at a time so the second row of the
  // pair picks up the second sheet rather than repeating the first.
  if (bomKeys.length > 1 && sheet === '') {
    bomByProduct.delete(lookup);
    opsByProduct.delete(lookup);
    ohByProduct.delete(lookup);
    report.ignored.push(
      `Product ${code}: costed in ${bomKeys.length} source sheets with identical totals; each kept, keyed by sheet.`,
    );
  }

  products.push({
    id: code,
    sourceSheet,
    designation: str(r['Description']),
    family: str(r['Family']),
    standard: str(r['Standard']),
    cores: Number(num(r['Cores']) ?? 0),
    sizeMm2: required(r['Size (mm2)'], `size for ${code}`),
    conductor: str(r['Conductor']),
    insulation: str(r['Insulation']),
    screen: str(r['Screen']),
    armour: str(r['Armour']),
    sheath: str(r['Sheath']),
    voltage: str(r['Voltage']),
    toolingPerKm: num(r['Tooling /km']) ?? '0',
    bom: bom.map((b) => ({
      materialKey: str(b['RM_Code']),
      materialName: str(b['Description']),
      consumption: required(b['Qty /km'], `qty for ${code}/${str(b['RM_Code'])}`),
      scrap: num(b['Scrap qty']) ?? '0',
    })),
    operations: ops.map((o, i) => ({
      machineKey: str(o['Machine_Code']),
      machineName: str(o['Machine_Code']),
      sequence: i + 1,
      hoursPerKm: required(o['Machine hours'], `hours for ${code}`),
      cores: num(o['Cores']) ?? '1',
    })),
    overheads: overheads
      .filter((o) => str(o['Overhead line']) !== TOOLING_OVERHEAD_LINE)
      .map((o) => ({
        key: str(o['Overhead line']),
        name: str(o['Overhead line']),
        amount: required(o['Value (OMR/km)'], `overhead for ${code}`),
      })),
  });

  // The parity fixture: what the source sheet itself says.
  fixtures.push({
    productId: code,
    sourceSheet,
    expected: {
      materialsSubtotal: required(r['RM cost /km (A)'], `A for ${code}`),
      operationsSubtotal: required(r['Operations /km (B)'], `B for ${code}`),
      overheadsSubtotal: required(r['Overheads /km (C)'], `C for ${code}`),
      tooling: num(r['Tooling /km']) ?? '0',
      costPerKm: required(r['Total cost /km'], `total for ${code}`),
      costPerMetre: required(r['Cost /metre'], `cost/m for ${code}`),
      quotePerMetre: required(r['Quote /metre'], `quote/m for ${code}`),
      /** The original sheet's own cost/m, before this workbook recomputed it. */
      sourceCostPerMetre: num(r['Source cost /m (orig)']),
    },
  });
}

count('products', products.length);
count('bom lines', bomRows.length);
count('operation lines', opRows.length);
count('overhead lines', ohRows.length);
report.ignored.push(
  `Overheads: the "${TOOLING_OVERHEAD_LINE}" line (99 rows) duplicates the Products sheet's Tooling /km column and is held once, as tooling.`,
);

// ── Write ───────────────────────────────────────────────────────────────

mkdirSync(DATA_OUT, { recursive: true });
rmSync(FIXTURE_OUT, { recursive: true, force: true });
mkdirSync(FIXTURE_OUT, { recursive: true });

const write = (path: string, value: unknown) =>
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);

write(join(DATA_OUT, 'drivers.json'), driversOut);
write(join(DATA_OUT, 'materials.json'), materials);
write(join(DATA_OUT, 'machines.json'), machines);
write(join(DATA_OUT, 'products.json'), products);

for (const f of fixtures as { productId: string; sourceSheet: string }[]) {
  const safe = `${f.productId}__${f.sourceSheet}`.replace(/[^A-Za-z0-9_-]+/g, '_');
  write(join(FIXTURE_OUT, `${safe}.json`), f);
}

// ── Reconciliation ──────────────────────────────────────────────────────

console.log('\nImport report — Nuhas_Cost_Master.xlsx\n');
for (const [what, n] of Object.entries(report.mapped)) {
  console.log(`  mapped    ${String(n).padStart(5)}  ${what}`);
}
for (const line of report.ignored) console.log(`  ignored          ${line}`);
for (const line of report.flagged) console.log(`  FLAGGED          ${line}`);

console.log(`\n  ${fixtures.length} parity fixtures written to tests/parity/fixtures`);
if (report.flagged.length > 0) {
  console.log(`\n  ${report.flagged.length} row(s) flagged — review before relying on this import.`);
  process.exitCode = 1;
}
