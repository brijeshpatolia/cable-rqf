import { notFound, redirect } from 'next/navigation';
import { session } from '@/infra/auth/session';
import { catalogueStore, rateWriter, repositories } from '@/infra/repositories';
import { can } from '@/modules/auth';
import { Panel } from '@/ui/components/Panel';
import {
  DesignEditor,
  type CodeOption,
  type DesignValue,
} from '@/ui/components/DesignEditor';
import { reviseDesign } from '../../actions';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return { title: `${id} design — Cable Quoting` };
}

/**
 * Revising a design.
 *
 * The construction is shown but not editable, which is exactly what Nuhas
 * asked for: the item code and what the cable *is* stay fixed, and what
 * changes is how it is built. Anything else would let a revision quietly turn
 * a 3-core into a 4-core and reprice every enquiry that had matched it.
 */
export default async function DesignPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await session.currentActor();
  if (actor === null) redirect('/sign-in');

  const { id } = await params;
  const [product, master, revisedBy] = await Promise.all([
    repositories.products.byId(id),
    rateWriter.master(),
    catalogueStore.revisedBy(id),
  ]);
  if (product === undefined) notFound();

  const options = (kind: 'material' | 'machine'): readonly CodeOption[] =>
    master
      .filter((m) => m.kind === kind)
      .map((m) => ({ code: m.code, description: m.description }))
      .sort((a, b) => a.code.localeCompare(b.code));

  const initial: DesignValue = {
    bom: product.bom.map((l) => ({
      code: l.materialKey,
      name: l.materialName,
      a: l.consumption.toString(),
      b: l.scrap.toString(),
    })),
    operations: product.operations.map((o) => ({
      code: o.machineKey,
      name: o.machineName,
      a: o.hoursPerKm.toString(),
      b: o.cores.toString(),
    })),
    overheads: product.overheads.map((o) => ({
      code: o.key,
      name: o.name,
      a: o.amount.toString(),
      b: '',
    })),
    tooling: product.toolingPerKm.toString(),
  };

  const spec = product.spec;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <a
          href={`/catalogue/${product.id}`}
          style={{ color: 'var(--color-ink-tertiary)', fontSize: 'var(--text-micro)' }}
        >
          ← {product.id}
        </a>
        <a
          href="/history"
          style={{
            marginLeft: 16,
            color: 'var(--color-copper)',
            fontSize: 'var(--text-micro)',
          }}
        >
          History →
        </a>
        <h1
          className="mt-2"
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'var(--text-display-lg)',
            lineHeight: 'var(--text-display-lg--line-height)',
            letterSpacing: 'var(--text-display-lg--letter-spacing)',
            fontWeight: 500,
          }}
        >
          Design
        </h1>
        <p className="mt-2" style={{ color: 'var(--color-ink-secondary)', maxWidth: 680 }}>
          {product.designation}
        </p>
      </header>

      <div className="flex gap-6">
        <div className="min-w-0 flex-1">
          <Panel title="Bill of materials, route and overheads">
            <DesignEditor
              action={reviseDesign}
              code={product.id}
              sourceSheet={product.sourceSheet ?? ''}
              initial={initial}
              materials={options('material')}
              machines={options('machine')}
              canEdit={can(actor, 'rate.edit')}
              revisedBy={revisedBy}
            />
          </Panel>
        </div>

        <aside style={{ width: 300 }} className="shrink-0 flex flex-col gap-6">
          <Panel title="Construction">
            {/*
              Read-only, deliberately. "We will keep construction and item code
              fixed" — a revision says how a cable is built, never what it is,
              so a 3-core cannot become a 4-core and silently reprice every
              enquiry that matched it.
            */}
            <div className="flex flex-col gap-3">
              {(
                [
                  ['Item code', product.id],
                  ['Cores', String(spec.cores)],
                  ['Size', `${spec.sizeMm2.toString()} mm²`],
                  ['Conductor', spec.conductor],
                  ['Insulation', spec.insulation],
                  ['Screen', spec.screen || '—'],
                  ['Armour', spec.armour || '—'],
                  ['Sheath', spec.sheath],
                  ['Voltage', spec.voltage],
                  ['Standard', spec.standard || '—'],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="flex items-baseline justify-between gap-3">
                  <span className="label">{label}</span>
                  <span className="numeric" style={{ textAlign: 'right' }}>
                    {value}
                  </span>
                </div>
              ))}
            </div>
            <p
              className="mt-4"
              style={{
                color: 'var(--color-ink-tertiary)',
                fontSize: 'var(--text-micro)',
                lineHeight: 'var(--text-micro--line-height)',
              }}
            >
              Fixed. A different construction is a different cable — add it as a
              new item code instead.
            </p>
            <a
              href="/catalogue/new"
              className="mt-3 inline-block"
              style={{ color: 'var(--color-copper)', fontSize: 'var(--text-micro)' }}
            >
              Add a new item →
            </a>
          </Panel>
        </aside>
      </div>
    </div>
  );
}
