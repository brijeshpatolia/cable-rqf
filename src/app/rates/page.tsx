import { formatDate, formatInstant, formatNumber } from '@/core/format';
import { session } from '@/infra/auth/session';
import { can } from '@/modules/auth';
import { LmeEntry } from '@/ui/components/RateEditors';
import { MasterEditor, type MasterRow } from '@/ui/components/MasterEditor';
import { amendRate, createRate, enterLmePrice, supersedeRate } from './actions';
import { rateWriter, repositories } from '@/infra/repositories';
import { now } from '@/infra/clock';
import { copperMetalValue } from '@/modules/costing';
import { sweep } from '@/modules/pricewatch';
import type { EffectiveRow } from '@/modules/rates';
import { CopperBlock } from '@/ui/components/CopperBlock';
import { DataTable } from '@/ui/components/DataTable';
import { RateTable, type RateRowView } from '@/ui/components/RateTable';
import { NumericCell } from '@/ui/components/NumericCell';
import { Panel } from '@/ui/components/Panel';
import type { Decimal } from '@/core/decimal';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Rate Desk — Cable Quoting' };

/**
 * Rate Desk — the Rate Owner's home.
 *
 * One governed place for every number that drives a price. Editing the LME
 * shows the blast radius before it commits, because repricing 99 products is
 * not an action anyone should take by accident.
 */
export default async function RateDeskPage() {
  const asOf = now();
  const { rates, quotes } = repositories;

  const [rateSet, materialRows, machineRows, lme, openQuotes, allProducts] = await Promise.all([
    rates.resolveAt(asOf),
    rates.materialRows(),
    rates.machineRows(),
    rates.lmeHistory(5),
    quotes.open(),
    repositories.products.list(),
  ]);

  const copper = copperMetalValue(rateSet.copper);
  const drift = sweep(openQuotes, rateSet.copper.lme, asOf);

  // The controls are hidden for anyone who may not use them — and the actions
  // behind them check again, because a hidden button is not a permission.
  const actor = await session.currentActor();
  const mayEdit = can(actor, 'rate.edit');

  /*
    The whole master, for the editor's picker and for the rate tables' labels.

    Previously the Rate Desk offered an edit box for one arbitrary "sample"
    code and one copper code — which meant 165 of the 167 rows were read-only,
    and adding a code was a spreadsheet job. That is the gap Sudhir's second
    finding names.

    Read for everyone, not only the Rate Owner: a table of bare codes is
    unreadable to anyone who has not memorised the master, and the description
    is what makes a row findable by meaning rather than by scrolling.
  */
  const master: readonly MasterRow[] = [...(await rateWriter.master())].sort((a, b) =>
    a.code.localeCompare(b.code),
  );

  const describes = new Map(master.map((m) => [m.code, m.description]));

  const view = (r: EffectiveRow<Decimal>): RateRowView => ({
    rateId: r.rateId,
    key: r.key,
    description: describes.get(r.key) ?? '',
    value: r.value.toString(),
    validFrom: r.validFrom.toISOString(),
    validTo: r.validTo === null ? null : r.validTo.toISOString(),
  });

  return (
    <div style={{ padding: 24 }} className="flex flex-col gap-6">
      <header className="flex items-start justify-between gap-8">
        <div>
          <h1
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 'var(--text-display-lg)',
              lineHeight: 'var(--text-display-lg--line-height)',
              letterSpacing: 'var(--text-display-lg--letter-spacing)',
              fontWeight: 500,
            }}
          >
            Rate Desk
          </h1>
          <p
            className="mt-2"
            style={{ color: 'var(--color-ink-secondary)', maxWidth: 560 }}
          >
            Every number that drives a price. One edit to copper reprices the
            whole library; every change is logged with who, when, and the
            previous value.
          </p>
        </div>

        <div style={{ width: 260 }} className="shrink-0">
          <CopperBlock
            copper={rateSet.copper}
            derivedOmrPerKg={copper}
            asOf={asOf}
          />
        </div>
      </header>

      {/*
        The blast radius, stated before the action rather than after it.
        This is the ConfirmBar's content, shown inline on the desk itself.
      */}
      <Panel title="Blast radius">
        <div className="flex flex-wrap items-baseline gap-x-10 gap-y-4">
          <Metric label="Products repriced" value={<Count n={allProducts.length} />} />
          <Metric label="Open quotes" value={<Count n={openQuotes.length} />} />
          <Metric
            label="Quotes flagged"
            value={<Count n={drift.breached.length} status={drift.breached.length > 0} />}
          />
          <Metric
            label="Exposure"
            value={
              <NumericCell value={drift.totalExposure} kind="total" unit="OMR" signed />
            }
          />
        </div>
      </Panel>

      <div className="flex gap-6">
        <div className="min-w-0 flex-1 flex flex-col gap-6">
          {/* No count in the panel header: the table's own toolbar carries it,
              and two numbers saying the same thing is just noise. */}
          <Panel title="Material rates" flush>
            <RateTable
              unit="OMR/kg"
              rows={[...materialRows].sort(sortRows).map(view)}
            />
          </Panel>

          <Panel title="Machine rates" flush>
            <RateTable
              unit="OMR/h"
              rows={[...machineRows].sort(sortRows).map(view)}
            />
          </Panel>
        </div>

        <aside style={{ width: 340 }} className="shrink-0 flex flex-col gap-6">
          {mayEdit ? (
            <>
              <Panel title="Enter copper price">
                <LmeEntry
                  action={enterLmePrice}
                  currentLme={rateSet.copper.lme.toString()}
                  currentFx={rateSet.copper.fx.toString()}
                  productCount={allProducts.length}
                />
              </Panel>

              <Panel
                title="The master"
                aside={
                  <span
                    className="numeric"
                    style={{
                      color: 'var(--color-ink-tertiary)',
                      fontSize: 'var(--text-micro)',
                    }}
                  >
                    {master.length} codes
                  </span>
                }
              >
                <MasterEditor
                  createAction={createRate}
                  amendAction={amendRate}
                  supersedeAction={supersedeRate}
                  rows={master}
                />
              </Panel>
            </>
          ) : (
            <Panel title="Rate editing">
              <p
                style={{
                  color: 'var(--color-ink-secondary)',
                  fontSize: 'var(--text-micro)',
                  lineHeight: 'var(--text-micro--line-height)',
                }}
              >
                {actor === null
                  ? 'Sign in as the rate owner to edit rates.'
                  : 'Only the rate owner may edit rates. Rate editing and quote approval are deliberately different people.'}
              </p>
              {actor === null ? (
                <a
                  href="/sign-in"
                  className="mt-3 block text-center"
                  style={{
                    backgroundColor: 'var(--color-copper)',
                    color: 'var(--color-ink-on-copper)',
                    borderRadius: 'var(--radius-md)',
                    padding: '7px 12px',
                    fontWeight: 550,
                  }}
                >
                  Sign in
                </a>
              ) : null}
            </Panel>
          )}

          <Panel title="LME copper" flush>
            <DataTable
              columns={[
                {
                  key: 'at',
                  header: 'Date',
                  render: (t) => (
                    <span
                      className="numeric"
                      style={{ color: 'var(--color-ink-secondary)' }}
                    >
                      {formatDate(t.at)}
                    </span>
                  ),
                },
                {
                  key: 'lme',
                  header: 'USD/t',
                  align: 'right',
                  render: (t) => <NumericCell value={t.lme} kind="lme" />,
                },
                {
                  key: 'by',
                  header: 'Entered by',
                  render: (t) => (
                    <span
                      style={{
                        color: 'var(--color-ink-tertiary)',
                        fontSize: 'var(--text-micro)',
                      }}
                    >
                      {t.enteredBy}
                    </span>
                  ),
                },
              ]}
              rows={lme}
              rowKey={(t) => t.at.toISOString()}
            />
          </Panel>

          <Panel title="Copper driver">
            <p
              style={{
                color: 'var(--color-ink-secondary)',
                fontSize: 'var(--text-micro)',
                lineHeight: 'var(--text-micro--line-height)',
              }}
            >
              OMR/kg = LME × FX ÷ 1000 + the drawing premium held on each of the
            39 LME-linked copper codes.
            </p>
            <div
              className="mt-3 numeric"
              style={{
                color: 'var(--color-ink-tertiary)',
                fontSize: 'var(--text-micro)',
                textAlign: 'left',
              }}
            >
              {formatNumber(rateSet.copper.lme, 2)} × {rateSet.copper.fx.toFixed(4)} ÷
              1000 = {copper.toFixed(6)} OMR/kg metal value
              <div className="mt-1">
                + drawing premium per copper code, 0.1026–0.1401 OMR/kg
              </div>
              <div className="mt-1">{formatInstant(asOf)}</div>
            </div>
          </Panel>
        </aside>
      </div>
    </div>
  );
}

/** Closed rows sink below the ones in force; keys stay together. */
function sortRows(a: EffectiveRow<Decimal>, b: EffectiveRow<Decimal>): number {
  if (a.key !== b.key) return a.key.localeCompare(b.key);
  return b.validFrom.getTime() - a.validFrom.getTime();
}

function Metric({
  label,
  value,
}: {
  readonly label: string;
  readonly value: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="label">{label}</span>
      {value}
    </div>
  );
}

function Count({ n, status = false }: { readonly n: number; readonly status?: boolean }) {
  return (
    <span
      className="numeric"
      style={{
        fontSize: 'var(--text-display-sm)',
        color: status ? 'var(--color-status-review)' : 'var(--color-ink-primary)',
        textAlign: 'left',
        display: 'block',
      }}
    >
      {n}
    </span>
  );
}
