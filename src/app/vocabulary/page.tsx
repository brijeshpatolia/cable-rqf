import { redirect } from 'next/navigation';
import { formatDate } from '@/core/format';
import { session } from '@/infra/auth/session';
import { substitutionStore, vocabularyStore } from '@/infra/repositories';
import { can } from '@/modules/auth';
import { axisLabel, type MatchAxis } from '@/modules/matching';
import { Panel } from '@/ui/components/Panel';
import { Substitutions } from '@/ui/components/Substitutions';
import { declareSubstitution, retireSubstitution } from '../jobs/actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Vocabulary — Cable Quoting' };

/**
 * The words and the swaps — everything the Rate Owner owns that is not a rate.
 *
 * Two lists, deliberately on one screen, because they answer the same question
 * from opposite ends. The dictionary says *what a customer's words mean*; the
 * allowlist says *what Nuhas will build instead of what was asked for*. Get
 * either wrong and lines price as the wrong cable — which is why both are the
 * Rate Owner's and neither is inferred from data.
 */
export default async function VocabularyPage() {
  const actor = await session.currentActor();
  if (actor === null) redirect('/sign-in');

  const [terms, rules] = await Promise.all([
    vocabularyStore.allTerms(),
    substitutionStore.all(),
  ]);

  // Every synonym on a learned term. "Taught" counts what the Rate Owner
  // answered; "seen" counts what customers went on to write.
  const learned = terms
    .filter((t) => t.learned)
    .flatMap((t) => t.synonyms.map((s) => ({ ...s, term: t })));
  const seenThisMonth = learned.filter(
    (s) =>
      s.lastSeenAt !== null &&
      Date.now() - s.lastSeenAt.getTime() < 31 * 24 * 60 * 60 * 1000,
  ).length;

  const byAxis = new Map<string, typeof terms>();
  for (const t of terms) {
    byAxis.set(t.axis, [...(byAxis.get(t.axis) ?? []), t]);
  }

  return (
    <div style={{ padding: 24 }} className="flex flex-col gap-6">
      <header>
        <h1
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'var(--text-display-lg)',
            lineHeight: 'var(--text-display-lg--line-height)',
            letterSpacing: 'var(--text-display-lg--letter-spacing)',
            fontWeight: 500,
          }}
        >
          Vocabulary
        </h1>
        <p className="mt-2" style={{ color: 'var(--color-ink-secondary)', maxWidth: 680 }}>
          What a customer&rsquo;s words mean, and what may be substituted for
          what. Both are the Rate Owner&rsquo;s to decide and neither is
          inferred from the data — the app pauses and asks rather than guessing,
          because a guess here misprices every future line containing the word.
        </p>
      </header>

      <Panel title="Learned">
        <div className="flex gap-10">
          <Stat
            label="Words taught"
            value={learned.length}
            hint="Synonyms added since go-live"
          />
          <Stat
            label="Seen this month"
            value={seenThisMonth}
            hint="Taught words a customer actually used"
          />
          <Stat
            label="Substitutions allowed"
            value={rules.filter((r) => r.retiredAt === null).length}
            hint="Swaps the Rate Owner has declared safe"
          />
        </div>
        <p
          className="mt-4"
          style={{
            color: 'var(--color-ink-secondary)',
            fontSize: 'var(--text-micro)',
            lineHeight: 'var(--text-micro--line-height)',
            maxWidth: 680,
          }}
        >
          The spec&rsquo;s promise is that the app stops asking after the first
          months. These numbers are how you tell whether it is keeping it: words
          taught should climb early and then flatten, while jobs stop pausing.
        </p>
      </Panel>

      <Panel
        title="Substitutions"
        aside={
          <span
            style={{ color: 'var(--color-ink-tertiary)', fontSize: 'var(--text-micro)' }}
          >
            Ships empty, by design
          </span>
        }
      >
        <Substitutions
          declareAction={declareSubstitution}
          retireAction={retireSubstitution}
          rules={rules.map((r) => ({
            id: r.id,
            axis: r.axis,
            axisName: axisLabel(r.axis as MatchAxis),
            from: r.from,
            to: r.to,
            rationale: r.rationale,
            declaredBy: r.declaredBy,
            declaredAt: formatDate(r.declaredAt),
            retired: r.retiredAt !== null,
          }))}
          canEdit={can(actor, 'rate.edit')}
        />
      </Panel>

      {[...byAxis.entries()].map(([axis, group]) => (
        <Panel key={axis} title={axisLabel(axis as MatchAxis)} flush>
          <div
            className="label flex items-baseline gap-3"
            style={{ padding: '6px 12px', borderBottom: '1px solid var(--color-line-strong)' }}
          >
            <span style={{ width: 150 }}>Term</span>
            <span className="flex-1">Written as</span>
            <span style={{ width: 90, textAlign: 'right' }}>Times seen</span>
            <span style={{ width: 110, textAlign: 'right' }}>Last seen</span>
          </div>

          {group.map((t) => (
            <div
              key={`${t.axis}-${t.canonical}`}
              className="flex items-baseline gap-3"
              style={{
                padding: '6px 12px',
                borderBottom: '1px solid var(--color-line-hairline)',
              }}
            >
              <span className="numeric" style={{ width: 150, textAlign: 'left' }}>
                {t.canonical}
                {t.learned ? (
                  <span
                    style={{
                      marginLeft: 6,
                      color: 'var(--color-status-review)',
                      fontSize: 'var(--text-micro)',
                    }}
                    title={`Added by ${t.createdBy ?? 'someone'}`}
                  >
                    new
                  </span>
                ) : null}
              </span>
              <span
                className="min-w-0 flex-1"
                style={{ color: 'var(--color-ink-secondary)', fontSize: 'var(--text-micro)' }}
              >
                {t.synonyms.map((s) => s.phrase).join(' · ')}
              </span>
              <span className="numeric" style={{ width: 90, textAlign: 'right' }}>
                {t.synonyms.reduce((a, s) => a + s.timesSeen, 0) || '—'}
              </span>
              <span
                className="numeric"
                style={{
                  width: 110,
                  textAlign: 'right',
                  color: 'var(--color-ink-tertiary)',
                  fontSize: 'var(--text-micro)',
                }}
              >
                {lastSeen(t.synonyms)}
              </span>
            </div>
          ))}
        </Panel>
      ))}
    </div>
  );
}

function lastSeen(synonyms: readonly { lastSeenAt: Date | null }[]): string {
  const dates = synonyms
    .map((s) => s.lastSeenAt)
    .filter((d): d is Date => d !== null)
    .sort((a, b) => b.getTime() - a.getTime());
  return dates[0] === undefined ? '—' : formatDate(dates[0]);
}

function Stat({
  label,
  value,
  hint,
}: {
  readonly label: string;
  readonly value: number;
  readonly hint: string;
}) {
  return (
    <div>
      <span className="label">{label}</span>
      <div
        className="numeric mt-1"
        style={{ fontSize: 'var(--text-numeric-lg)', fontWeight: 550 }}
      >
        {value}
      </div>
      <span
        style={{ color: 'var(--color-ink-tertiary)', fontSize: 'var(--text-micro)' }}
      >
        {hint}
      </span>
    </div>
  );
}
