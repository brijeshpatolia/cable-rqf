import type { ReactNode } from 'react';

interface PanelProps {
  readonly title?: string;
  /** Sits right-aligned in the title row — filters, a count, an action. */
  readonly aside?: ReactNode;
  readonly children: ReactNode;
  /** Tables manage their own cell padding; panels around them use `flush`. */
  readonly flush?: boolean;
}

/**
 * Hairline border, 4px radius, panel surface. No shadow, no gradient.
 * Structure comes from alignment and rule lines (DESIGN_SYSTEM.md §1, rule 3).
 */
export function Panel({ title, aside, children, flush = false }: PanelProps) {
  return (
    <section
      style={{
        backgroundColor: 'var(--color-surface-panel)',
        border: '1px solid var(--color-line-hairline)',
        borderRadius: 'var(--radius-lg)',
      }}
    >
      {title !== undefined ? (
        <header
          className="flex items-center justify-between"
          style={{
            padding: '10px 16px',
            borderBottom: '1px solid var(--color-line-strong)',
          }}
        >
          <h2
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 'var(--text-heading)',
              lineHeight: 'var(--text-heading--line-height)',
              letterSpacing: 'var(--text-heading--letter-spacing)',
              fontWeight: 550,
            }}
          >
            {title}
          </h2>
          {aside}
        </header>
      ) : null}
      <div style={flush ? undefined : { padding: 16 }}>{children}</div>
    </section>
  );
}

/** A labelled value. Label above in `label` type, value below. */
export function Field({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="label">{label}</span>
      <span>{children}</span>
    </div>
  );
}
