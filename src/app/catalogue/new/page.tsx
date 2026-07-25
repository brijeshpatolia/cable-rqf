import { redirect } from 'next/navigation';
import { session } from '@/infra/auth/session';
import { rateWriter } from '@/infra/repositories';
import { can } from '@/modules/auth';
import { NewProduct } from '@/ui/components/NewProduct';
import { Panel } from '@/ui/components/Panel';
import { createProduct } from '../actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'New item — Cable Quoting' };

/**
 * Adding an item code, with its construction and its design.
 *
 * The fourth finding. Everything is set once here, construction included,
 * because there is nothing yet to keep fixed — after this, the construction
 * stops being editable and only the design can change.
 *
 * A new item matches, prices and quotes exactly like an imported one. The only
 * thing that distinguishes it is its provenance: it carries no source cost
 * sheet, because it never had one.
 */
export default async function NewProductPage() {
  const actor = await session.currentActor();
  if (actor === null) redirect('/sign-in');

  const master = await rateWriter.master();
  const options = (kind: 'material' | 'machine') =>
    master
      .filter((m) => m.kind === kind)
      .map((m) => ({ code: m.code, description: m.description }))
      .sort((a, b) => a.code.localeCompare(b.code));

  return (
    <div style={{ padding: 24 }} className="flex flex-col gap-6">
      <header>
        <a href="/catalogue" style={{ color: 'var(--color-ink-tertiary)', fontSize: 'var(--text-micro)' }}>
          ← Catalogue
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
          New item
        </h1>
        <p className="mt-2" style={{ color: 'var(--color-ink-secondary)', maxWidth: 680 }}>
          The construction is set once, here — afterwards only the design
          changes, because a different construction is a different cable. Once
          saved it matches, prices and quotes exactly like an imported item.
        </p>
      </header>

      <Panel title="Construction and design">
        <NewProduct
          action={createProduct}
          materials={options('material')}
          machines={options('machine')}
          canEdit={can(actor, 'rate.edit')}
        />
      </Panel>
    </div>
  );
}
