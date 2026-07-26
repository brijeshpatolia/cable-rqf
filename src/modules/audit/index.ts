import type { AuditEvent } from '@/modules/rates';

/**
 * Reading the audit trail back.
 *
 * Every write path in this app records who changed what, from what, to what,
 * and why. Until now nothing read those rows — the Rate Desk told an engineer
 * "every change is logged with who, when, and the previous value" and offered
 * no way to look. A promise nobody can check is not a control.
 *
 * This module is the reading half, and it is deliberately only presentation:
 * an `entity` string like `material_rate:ABPT025` names a thing, and this says
 * what kind of thing it is and what to call it. It knows nothing about routes
 * — where a subject is *linked* is the screen's business, and a pure module
 * that hard-coded `/rates` would be a layering violation with extra steps.
 */

export type EntityKind =
  | 'material'
  | 'machine'
  | 'copper'
  | 'product'
  | 'job'
  | 'quote'
  | 'substitution'
  | 'vocabulary'
  | 'account'
  | 'other';

export interface Subject {
  readonly kind: EntityKind;
  /** What kind of thing, in words: `Material rate`. */
  readonly label: string;
  /** Which one: `ABPT025`. Empty when the entity is a singleton. */
  readonly name: string;
}

const KINDS: Readonly<Record<string, { readonly kind: EntityKind; readonly label: string }>> =
  {
    material_rate: { kind: 'material', label: 'Material rate' },
    machine_rate: { kind: 'machine', label: 'Machine rate' },
    lme_price: { kind: 'copper', label: 'Copper price' },
    product: { kind: 'product', label: 'Product' },
    job: { kind: 'job', label: 'Enquiry' },
    quote: { kind: 'quote', label: 'Quote' },
    substitution: { kind: 'substitution', label: 'Substitution' },
    vocabulary: { kind: 'vocabulary', label: 'Dictionary' },
    app_user: { kind: 'account', label: 'Account' },
    cost_master: { kind: 'other', label: 'Cost master' },
  };

/**
 * `material_rate:ABPT025` → Material rate, ABPT025.
 *
 * An entity this does not recognise keeps its raw string as the name rather
 * than being hidden or relabelled. A trail that quietly drops rows it cannot
 * classify is worse than one that shows them awkwardly — the whole value of
 * the thing is that nothing is missing from it.
 */
export function subjectOf(entity: string): Subject {
  const at = entity.indexOf(':');
  const prefix = at === -1 ? entity : entity.slice(0, at);
  const name = at === -1 ? '' : entity.slice(at + 1);
  const known = KINDS[prefix];
  if (known === undefined) return { kind: 'other', label: 'Other', name: entity };
  return { ...known, name };
}

/**
 * Field names, in the words a person would use.
 *
 * Only the ones whose stored name is opaque. Anything else falls through with
 * its underscores turned into spaces, which reads perfectly well for `design`
 * or `status` and is honest about not having been given special treatment.
 *
 * The dictionary is the interesting exception: a vocabulary row's *field* is
 * the phrase that was taught, so `xlpo` means the word itself, not a column.
 */
const FIELDS: Readonly<Record<string, string>> = {
  raw_text: 'enquiry text',
  master: 'code details',
  rate: 'rate',
  lme: 'LME price',
  drawing_premium: 'drawing premium',
  account: 'account',
  design: 'design and bill of materials',
  status: 'status',
};

export function fieldLabel(entity: string, field: string): string {
  if (subjectOf(entity).kind === 'vocabulary') return `the phrase “${field}”`;
  // `line:4` is a decision about one line of an enquiry.
  const line = /^line:(\d+)$/.exec(field);
  if (line !== null) return `line ${Number(line[1]) + 1}`;
  return FIELDS[field] ?? field.replace(/_/g, ' ');
}

/** Nothing there before. The trail says so rather than showing a blank. */
export const ABSENT = '—';

export interface Change {
  readonly subject: Subject;
  readonly what: string;
  readonly from: string;
  readonly to: string;
  readonly reason: string | null;
  readonly actor: string;
  readonly at: Date;
}

export function changeOf(event: AuditEvent): Change {
  const subject = subjectOf(event.entity);
  return {
    subject,
    what: fieldLabel(event.entity, event.field),
    from: event.previous === '' ? ABSENT : event.previous,
    to: event.next === '' ? ABSENT : event.next,
    reason: event.reason ?? null,
    actor: event.actor,
    at: event.at,
  };
}

/** The kinds present in a set of events, for the filter chips. */
export function kindsIn(events: readonly AuditEvent[]): readonly EntityKind[] {
  const seen = new Set<EntityKind>();
  for (const e of events) seen.add(subjectOf(e.entity).kind);
  return [...seen].sort();
}

/**
 * Does this row match what was typed?
 *
 * Matched across the subject, the field and the reason together, because an
 * engineer looking for a change remembers one of the three and rarely knows
 * which column it lives in. Not across `previous`/`next`: searching for `0.7`
 * would surface every row where a number happened to contain it, which is
 * noise dressed as a result.
 */
export function matches(event: AuditEvent, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === '') return true;
  const subject = subjectOf(event.entity);
  return [
    event.entity,
    subject.label,
    subject.name,
    fieldLabel(event.entity, event.field),
    event.reason ?? '',
    event.actor,
  ].some((s) => s.toLowerCase().includes(needle));
}
