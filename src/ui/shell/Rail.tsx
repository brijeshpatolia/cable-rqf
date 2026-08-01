import { roleLabel, type Actor } from '@/modules/auth';
import { WhoAmI } from '@/ui/components/WhoAmI';
import { RailNav } from './RailNav';

/**
 * The left rail.
 *
 * Three changes from the version this replaces, all of them about answering
 * "where am I" — a question the old rail could not answer at all.
 *
 * **Grouped.** Eight flat links in one list made the app read as eight equal
 * things. They are not: Work is what an engineer does all day, Library is what
 * the Rate Owner curates, Rates is what moves the numbers. The grouping is the
 * app's own shape, stated.
 *
 * **An active state.** There was none. A rail with no active item is a list of
 * links, and on a screen you live in all day that is a small, constant tax.
 * The marker is copper — the one place the accent appears outside a price and
 * a primary action, and it earns it by being the answer to "where am I".
 *
 * **No phase badges.** `P1` and `P2` beside every item were roadmap
 * scaffolding: true of the project, useless to the person costing a cable.
 * They are gone. The waiting count stays, because that is work.
 *
 * Still a server component. Only the links know where you are, and they say
 * why in `RailNav` — a path forwarded on the request cannot answer that
 * question once navigation stopped reloading the document.
 */

export function Rail({
  actor,
  waiting,
}: {
  readonly actor: Actor | null;
  readonly waiting: number;
}) {
  return (
    <nav
      className="shrink-0 flex flex-col sticky top-0"
      style={{
        width: 'var(--rail-width)',
        height: '100vh',
        borderRight: '1px solid var(--color-line-panel)',
        backgroundColor: 'var(--color-surface-inset)',
      }}
    >
      <div
        className="flex items-center"
        style={{ padding: '18px 18px 16px', gap: 10 }}
      >
        {/*
          Placeholder for the company mark. A copper square rather than a
          letterform, so nobody mistakes it for a finished logo.
        */}
        <div
          aria-hidden
          style={{
            width: 22,
            height: 22,
            borderRadius: 6,
            backgroundColor: 'var(--color-copper)',
            flexShrink: 0,
          }}
        />
        {/*
          The product name alone. The company name used to sit under it, which
          was my addition in the 2026 shell and not asked for — an operator who
          works here all day does not need telling which company they work for,
          and it made the app read as marketing for its own owner. Where the
          name genuinely belongs is on the quote that goes out, which is a
          document about the company rather than a tool used inside it.
        */}
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 13.5,
            fontWeight: 600,
            letterSpacing: '-0.01em',
            lineHeight: 1.15,
          }}
        >
          Cable Quoting
        </div>
      </div>

      <RailNav waiting={waiting} />

      {actor === null ? null : <WhoAmI name={actor.name} role={roleLabel(actor.role)} />}
    </nav>
  );
}
