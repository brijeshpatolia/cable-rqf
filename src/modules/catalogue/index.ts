import { type Decimal, dec } from '@/core/decimal';
import { type Result, err, ok } from '@/core/result';
import type { Actor } from '@/modules/auth';
import type { CableSpec, Product } from '@/modules/costing';

/**
 * The product library, as something a person can change.
 *
 * Until now the catalogue was whatever the importer read out of the cost
 * master: 99 products, fixed. That is fine for a month and wrong forever — a
 * cable house changes a bill of materials when a supplier changes, and adds an
 * item code when it wins a new build. Both were spreadsheet jobs, which meant
 * the app's library and the real one drifted apart on the first change.
 *
 * Two operations, deliberately different in what they let you touch:
 *
 * - **Revising a design** keeps the item code and the construction fixed and
 *   changes the bill of materials, the machine route, the overheads and the
 *   tooling. That is the shape of the real change: the cable is the same
 *   cable, built differently.
 * - **Adding an item** sets everything once, construction included, because
 *   there is nothing yet to keep fixed.
 *
 * Pure. It decides whether a design is coherent and says why not; `infra`
 * writes it down.
 */

export interface DesignLine {
  readonly materialKey: string;
  readonly materialName: string;
  /** kg/km, before scrap. */
  readonly consumption: Decimal;
  /** Absolute quantity, as the source sheets hold it — never a percentage. */
  readonly scrap: Decimal;
}

export interface DesignOperation {
  readonly machineKey: string;
  readonly machineName: string;
  readonly hoursPerKm: Decimal;
  /**
   * The multiplier this stage runs at. The cost master calls it "Cores" but it
   * is not an integer count — 117 of 728 imported rows are fractional, up to
   * 97.2 — so it is a Decimal here as it is everywhere else.
   */
  readonly cores: Decimal;
}

export interface DesignOverhead {
  readonly key: string;
  readonly name: string;
  readonly amount: Decimal;
}

export interface Design {
  readonly bom: readonly DesignLine[];
  readonly operations: readonly DesignOperation[];
  readonly overheads: readonly DesignOverhead[];
  readonly toolingPerKm: Decimal;
}

export type CatalogueErrorCode =
  | 'NO_CODE'
  | 'CODE_TAKEN'
  | 'NO_MATERIALS'
  | 'UNKNOWN_MATERIAL'
  | 'UNKNOWN_MACHINE'
  | 'BAD_QUANTITY'
  | 'DUPLICATE_LINE'
  | 'NO_REASON'
  | 'BAD_SPEC';

export interface CatalogueError {
  readonly code: CatalogueErrorCode;
  readonly message: string;
}

/** What the master holds, so a design can only point at codes that exist. */
export interface KnownCodes {
  readonly materials: ReadonlySet<string>;
  readonly machines: ReadonlySet<string>;
}

export interface ReviseRequest {
  readonly product: Product;
  readonly design: Design;
  readonly known: KnownCodes;
  readonly reason: string;
  readonly actor: Actor;
  readonly at: Date;
}

export interface RevisePlan {
  readonly productId: string;
  readonly code: string;
  readonly design: Design;
  readonly audit: {
    readonly actorId: string;
    readonly actorEmail: string;
    readonly entity: string;
    readonly field: string;
    readonly previous: string;
    readonly next: string;
    readonly reason: string;
  };
}

/**
 * Validates a design, whether it is new or a revision.
 *
 * Every rule here has the same shape: a design that points at a code the
 * master does not hold, or carries a quantity nobody can cost, is not a design
 * the engine can price — and it is far better to say so at the moment somebody
 * types it than to have the line fail silently on the next quote.
 */
function checkDesign(
  design: Design,
  known: KnownCodes,
): CatalogueError | null {
  if (design.bom.length === 0) {
    return {
      code: 'NO_MATERIALS',
      message: 'A cable with no bill of materials has no cost. Add at least one material.',
    };
  }

  const seen = new Set<string>();
  for (const line of design.bom) {
    const key = line.materialKey.trim().toUpperCase();

    if (key === '') {
      return { code: 'UNKNOWN_MATERIAL', message: 'Every material line needs a code.' };
    }
    if (!known.materials.has(key)) {
      return {
        code: 'UNKNOWN_MATERIAL',
        message:
          `${key} is not in the raw material master. Add it there first — a ` +
          'bill of materials pointing at a code with no rate cannot be costed.',
      };
    }
    if (seen.has(key)) {
      return {
        code: 'DUPLICATE_LINE',
        message: `${key} appears twice. Combine the quantities into one line rather than costing it in two places.`,
      };
    }
    seen.add(key);

    if (!line.consumption.isFinite() || line.consumption.lessThanOrEqualTo(0)) {
      return {
        code: 'BAD_QUANTITY',
        message: `${key}: consumption has to be a positive number of kg/km.`,
      };
    }
    if (!line.scrap.isFinite() || line.scrap.lessThan(0)) {
      return {
        code: 'BAD_QUANTITY',
        message: `${key}: scrap is an absolute quantity in kg/km, and cannot be negative.`,
      };
    }
  }

  const machinesSeen = new Set<string>();
  for (const op of design.operations) {
    const key = op.machineKey.trim().toUpperCase();
    if (key === '') {
      return { code: 'UNKNOWN_MACHINE', message: 'Every machine stage needs a code.' };
    }
    if (!known.machines.has(key)) {
      return {
        code: 'UNKNOWN_MACHINE',
        message: `${key} is not a machine the master holds. Add it there first.`,
      };
    }
    // A machine legitimately runs twice in one route — drawing, then
    // re-drawing — so duplicates are allowed here where they are not on the
    // bill of materials. Only a stage repeated at identical hours is suspect.
    const signature = `${key}:${op.hoursPerKm.toString()}:${op.cores.toString()}`;
    if (machinesSeen.has(signature)) {
      return {
        code: 'DUPLICATE_LINE',
        message: `${key} appears twice at identical hours and multiplier. That is double-counting, not a second pass.`,
      };
    }
    machinesSeen.add(signature);

    if (!op.hoursPerKm.isFinite() || op.hoursPerKm.lessThan(0)) {
      return { code: 'BAD_QUANTITY', message: `${key}: hours per km cannot be negative.` };
    }
    if (!op.cores.isFinite() || op.cores.lessThanOrEqualTo(0)) {
      return {
        code: 'BAD_QUANTITY',
        message: `${key}: the multiplier has to be positive — it multiplies the machine time.`,
      };
    }
  }

  for (const o of design.overheads) {
    if (o.key.trim() === '') {
      return { code: 'BAD_QUANTITY', message: 'Every overhead line needs a name.' };
    }
    if (!o.amount.isFinite() || o.amount.lessThan(0)) {
      return { code: 'BAD_QUANTITY', message: `${o.name}: an overhead cannot be negative.` };
    }
  }

  if (!design.toolingPerKm.isFinite() || design.toolingPerKm.lessThan(0)) {
    return { code: 'BAD_QUANTITY', message: 'Tooling cannot be negative.' };
  }

  return null;
}

/** A one-line summary of what changed, so the audit row reads without a diff. */
function describeChange(before: Product, after: Design): string {
  const parts: string[] = [];

  const materialsBefore = before.bom.length;
  if (materialsBefore !== after.bom.length) {
    parts.push(`materials ${materialsBefore} → ${after.bom.length}`);
  }
  if (before.operations.length !== after.operations.length) {
    parts.push(`stages ${before.operations.length} → ${after.operations.length}`);
  }
  if (before.overheads.length !== after.overheads.length) {
    parts.push(`overheads ${before.overheads.length} → ${after.overheads.length}`);
  }
  if (before.toolingPerKm.toString() !== after.toolingPerKm.toString()) {
    parts.push(
      `tooling ${before.toolingPerKm.toString()} → ${after.toolingPerKm.toString()}`,
    );
  }

  // Quantities changed without the shape changing is the commonest revision,
  // and the one a bare count comparison would report as "nothing happened".
  const changedQuantities = after.bom.filter((line) => {
    const was = before.bom.find((b) => b.materialKey === line.materialKey);
    return (
      was !== undefined &&
      (was.consumption.toString() !== line.consumption.toString() ||
        was.scrap.toString() !== line.scrap.toString())
    );
  });
  if (changedQuantities.length > 0) {
    parts.push(
      `${changedQuantities.length} quantit${changedQuantities.length === 1 ? 'y' : 'ies'} changed`,
    );
  }

  return parts.length === 0 ? 'design re-saved unchanged' : parts.join(', ');
}

/**
 * Revising an existing item code.
 *
 * The construction and the code stay fixed, which is exactly what Nuhas asked
 * for: this is the same cable, built differently. Nothing here can change what
 * the cable *is*, so a revision can never quietly turn a 3-core into a 4-core
 * and reprice every enquiry that matched it.
 */
export function planRevise(
  request: ReviseRequest,
): Result<RevisePlan, CatalogueError> {
  if (request.reason.trim() === '') {
    return err({
      code: 'NO_REASON',
      message:
        'Say why. Every quote struck from now on carries this design, and in ' +
        'six months this sentence is the only thing that explains the change.',
    });
  }

  const problem = checkDesign(request.design, request.known);
  if (problem !== null) return err(problem);

  return ok({
    productId: request.product.id,
    code: request.product.id,
    design: normalise(request.design),
    audit: {
      actorId: request.actor.id,
      actorEmail: request.actor.email,
      entity: `product:${request.product.id}`,
      field: 'design',
      previous: `${request.product.bom.length} materials, ${request.product.operations.length} stages`,
      next: describeChange(request.product, request.design),
      reason: request.reason.trim(),
    },
  });
}

export interface CreateProductRequest {
  readonly code: string;
  readonly spec: CableSpec;
  readonly family: string;
  readonly designation?: string;
  readonly design: Design;
  readonly known: KnownCodes;
  /** Every code already in the library, so a duplicate is refused. */
  readonly existingCodes: ReadonlySet<string>;
  readonly reason: string;
  readonly actor: Actor;
}

export interface CreateProductPlan {
  readonly code: string;
  readonly designation: string;
  readonly spec: CableSpec;
  readonly family: string;
  readonly design: Design;
  readonly audit: RevisePlan['audit'];
}

/**
 * Composes the designation from the construction.
 *
 * The imported library writes them by hand and they vary; a new item gets a
 * consistent one built from the fields that define it, so the catalogue does
 * not slowly fill with cables described five different ways.
 */
export function designationFor(spec: CableSpec, family: string): string {
  return [
    family.toUpperCase(),
    spec.standard,
    `${spec.cores}Cx${spec.sizeMm2.toString()} mm2`,
    spec.conductor,
    spec.insulation,
    spec.screen,
    spec.armour,
    spec.sheath,
    spec.voltage,
  ]
    .filter((part) => part.trim() !== '')
    .join(' - ');
}

export function planCreateProduct(
  request: CreateProductRequest,
): Result<CreateProductPlan, CatalogueError> {
  const code = request.code.trim().toUpperCase();

  if (code === '') {
    return err({ code: 'NO_CODE', message: 'An item code is what a quote line points at.' });
  }
  if (request.existingCodes.has(code)) {
    return err({
      code: 'CODE_TAKEN',
      message: `${code} is already in the library. Revise its design instead — two products sharing a code is how an enquiry prices as the wrong cable.`,
    });
  }
  if (request.reason.trim() === '') {
    return err({ code: 'NO_REASON', message: 'Say why this item is being added.' });
  }

  const spec = request.spec;
  if (!Number.isInteger(spec.cores) || spec.cores <= 0) {
    return err({ code: 'BAD_SPEC', message: 'Core count has to be a whole number above zero.' });
  }
  if (!spec.sizeMm2.isFinite() || spec.sizeMm2.lessThanOrEqualTo(0)) {
    return err({ code: 'BAD_SPEC', message: 'Conductor size has to be a positive number of mm².' });
  }
  for (const [label, value] of [
    ['conductor', spec.conductor],
    ['insulation', spec.insulation],
    ['sheath', spec.sheath],
    ['voltage', spec.voltage],
  ] as const) {
    if (value.trim() === '') {
      return err({
        code: 'BAD_SPEC',
        message: `A cable needs a ${label} — it is one of the fields the matcher compares.`,
      });
    }
  }

  const problem = checkDesign(request.design, request.known);
  if (problem !== null) return err(problem);

  const designation =
    request.designation?.trim() !== undefined && request.designation.trim() !== ''
      ? request.designation.trim()
      : designationFor(spec, request.family);

  return ok({
    code,
    designation,
    spec,
    family: request.family.trim() === '' ? 'CUSTOM' : request.family.trim().toUpperCase(),
    design: normalise(request.design),
    audit: {
      actorId: request.actor.id,
      actorEmail: request.actor.email,
      entity: `product:${code}`,
      field: 'exists',
      previous: 'no',
      next: `${request.design.bom.length} materials, ${request.design.operations.length} stages`,
      reason: request.reason.trim(),
    },
  });
}

/** Codes upper-cased and trimmed, so a design cannot miss a rate on casing. */
function normalise(design: Design): Design {
  return {
    bom: design.bom.map((l) => ({ ...l, materialKey: l.materialKey.trim().toUpperCase() })),
    operations: design.operations.map((o) => ({
      ...o,
      machineKey: o.machineKey.trim().toUpperCase(),
    })),
    overheads: design.overheads.map((o) => ({ ...o, key: o.key.trim() })),
    toolingPerKm: design.toolingPerKm,
  };
}

/** An empty design, for the new-item form to start from. */
export const EMPTY_DESIGN: Design = {
  bom: [],
  operations: [],
  overheads: [],
  toolingPerKm: dec(0),
};
