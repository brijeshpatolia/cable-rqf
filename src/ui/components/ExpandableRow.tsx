'use client';

import { useId, useState, type ReactNode } from 'react';

interface ExpandableRowProps {
  /** The collapsed row's content. Reads as a single clean line. */
  readonly summary: ReactNode;
  /**
   * The breakdown. Rendered on the server and passed in as children — never
   * fetched on click. There is no loading state because there is no load
   * (DESIGN_SYSTEM.md §6, rule 2).
   */
  readonly children: ReactNode;
  readonly defaultOpen?: boolean;
  /** Nesting depth. Each level insets 16px, so structure reads from alignment. */
  readonly depth?: number;
  /** Sets the interior surface. Only the outermost level steps up a shade. */
  readonly raised?: boolean;
  /**
   * `shell` swaps the raised interior for a left rule.
   *
   * The nesting then reads from alignment alone, which is what the rest of the
   * app already claims to do — a second surface behind an open row was the one
   * place depth came from a fill rather than from structure. It also stops the
   * interior competing with the inset section cards inside it.
   */
  readonly scale?: 'dense' | 'shell';
}

/**
 * The signature interaction.
 *
 * A quote line reads as one clean row — cable, quantity, price. Click it and
 * it unfolds in place into the complete build-up. Close it and the row is
 * clean again. Never a modal, never a navigation; the engineer never loses
 * their place.
 */
export function ExpandableRow({
  summary,
  children,
  defaultOpen = false,
  depth = 0,
  raised = true,
  scale = 'dense',
}: ExpandableRowProps) {
  const [open, setOpen] = useState(defaultOpen);
  const regionId = useId();
  const shell = scale === 'shell';

  return (
    <div style={{ borderBottom: '1px solid var(--color-line-hairline)' }}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={regionId}
        onClick={() => setOpen((v) => !v)}
        data-open={open}
        className={`row-hover flex w-full items-center text-left ${shell ? 'gap-4' : 'gap-3'}`}
        style={{
          minHeight: shell ? undefined : 'var(--row-height)',
          padding: shell ? '11px 18px' : 'var(--cell-pad-y) var(--cell-pad-x)',
          paddingLeft: shell
            ? `calc(18px + ${depth * 16}px)`
            : `calc(var(--cell-pad-x) + ${depth * 16}px)`,
        }}
      >
        <Chevron open={open} size={shell ? 9 : 8} />
        <span className="min-w-0 flex-1">{summary}</span>
      </button>

      <div id={regionId} className="expand-region" data-open={open} role="region">
        <div>
          <div
            style={
              shell
                ? {
                    padding: '4px 18px 18px 41px',
                  }
                : {
                    backgroundColor: raised ? 'var(--color-surface-raised)' : 'transparent',
                    paddingLeft: `calc(var(--cell-pad-x) + ${(depth + 1) * 16}px)`,
                    paddingRight: 'var(--cell-pad-x)',
                    paddingTop: 4,
                    paddingBottom: 8,
                  }
            }
          >
            {shell ? (
              <div
                style={{
                  borderLeft: '1px solid var(--color-line-strong)',
                  paddingLeft: 18,
                }}
              >
                {children}
              </div>
            ) : (
              children
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Chevron({ open, size = 8 }: { readonly open: boolean; readonly size?: number }) {
  return (
    <svg
      aria-hidden
      width={size}
      height={size}
      viewBox="0 0 8 8"
      style={{
        color: 'var(--color-ink-tertiary)',
        flexShrink: 0,
        transform: open ? 'rotate(90deg)' : 'none',
        transition: `transform var(--duration-expand) var(--ease-expand)`,
      }}
    >
      <path d="M2 0 L7 4 L2 8 Z" fill="currentColor" />
    </svg>
  );
}

/**
 * The strike line that closes every breakdown. States the copper price and FX
 * the numbers above were built on, and the instant they were struck.
 */
export function StrikeFooter({ children }: { readonly children: ReactNode }) {
  return (
    <div
      style={{
        borderTop: '1px solid var(--color-line-hairline)',
        marginTop: 8,
        paddingTop: 6,
        color: 'var(--color-ink-tertiary)',
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--text-micro)',
        lineHeight: 'var(--text-micro--line-height)',
      }}
    >
      {children}
    </div>
  );
}

/**
 * The provenance line under a leaf. Every terminal number in the app carries
 * one — which rate row it drew from, and when that rate took effect.
 */
export function Provenance({ children }: { readonly children: ReactNode }) {
  return (
    <div
      style={{
        // Faint and small on purpose: present under every terminal number,
        // read only when somebody asks where a figure came from. The `└` glyph
        // this used to carry is gone — the indent and the colour already say
        // "belongs to the line above", and a box-drawing character at 10px is
        // a smudge in most fonts.
        color: 'var(--color-ink-faint)',
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--text-mono-nano)',
        lineHeight: '15px',
        marginTop: 2,
      }}
    >
      {children}
    </div>
  );
}
