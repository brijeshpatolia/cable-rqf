import type { ReactNode } from 'react';

interface PanelProps {
  readonly title?: string;
  /** Sits right-aligned in the title row — filters, a count, an action. */
  readonly aside?: ReactNode;
  /** A sentence beside the title saying what the panel is for. */
  readonly note?: string;
  readonly children: ReactNode;
  /** Tables manage their own cell padding; panels around them use `flush`. */
  readonly flush?: boolean;
  /**
   * `dense` — 4px radius, hairline border. The default, and what every list
   * of records uses.
   * `shell` — 12px radius, panel border, inner top highlight. The two screens
   * the 2026 redesign covers. See the radius note in `tokens.css`.
   */
  readonly scale?: 'dense' | 'shell';
}

/**
 * Panel surface, no shadow, no gradient. Structure comes from alignment and
 * rule lines (DESIGN_SYSTEM.md §1, rule 3) — and, at `shell` scale, from a 1px
 * inner top highlight, which is the only depth cue in the app that is not a
 * hairline.
 */
export function Panel({
  title,
  aside,
  note,
  children,
  flush = false,
  scale = 'dense',
}: PanelProps) {
  const shell = scale === 'shell';

  return (
    <section
      className={shell ? 'panel-shell' : undefined}
      style={
        shell
          ? { overflow: 'hidden' }
          : {
              backgroundColor: 'var(--color-surface-panel)',
              border: '1px solid var(--color-line-hairline)',
              borderRadius: 'var(--radius-lg)',
            }
      }
    >
      {title !== undefined ? (
        <header
          className="flex items-center justify-between"
          style={{
            padding: shell ? '13px 16px 13px 18px' : '10px 16px',
            borderBottom: `1px solid var(${shell ? '--color-line-panel' : '--color-line-strong'})`,
            gap: 12,
          }}
        >
          <div className="flex items-baseline min-w-0" style={{ gap: 10 }}>
            <h2
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 'var(--text-heading)',
                lineHeight: 'var(--text-heading--line-height)',
                letterSpacing: 'var(--text-heading--letter-spacing)',
                fontWeight: shell ? 600 : 550,
                whiteSpace: 'nowrap',
              }}
            >
              {title}
            </h2>
            {note === undefined ? null : (
              <span
                style={{
                  fontSize: 11.5,
                  color: 'var(--color-ink-tertiary)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {note}
              </span>
            )}
          </div>
          {aside}
        </header>
      ) : null}
      <div style={flush ? undefined : { padding: shell ? 18 : 16 }}>{children}</div>
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
