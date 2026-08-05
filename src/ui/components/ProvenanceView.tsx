'use client';

import { useEffect, useRef, useState } from 'react';

export interface ExtractedEntry {
  /** Position in the enquiry — the same number the Lines panel counts by. */
  readonly index: number;
  readonly text: string;
  /** Where the reader found it: `Schedule of Cables, row 12`. */
  readonly where: string;
  /** Index into the document's lines, or null when provenance was dropped. */
  readonly line: number | null;
}

/**
 * The document, beside what was read out of it.
 *
 * This is where the trust is won. Everything else in Phase 3 asks an engineer
 * to believe that a quantity on a screen is the quantity in the file; this is
 * the screen that shows them, without opening the attachment.
 *
 * Selecting either side selects the other. The source is marked with a copper
 * rule down its left — not a highlight fill, which would fight the status
 * colours and imply a state the row does not have.
 *
 * **The rows the reader left out are here too**, in tertiary ink. That is
 * deliberate and is the more useful half: a covering letter is noise, but a
 * cable line the extractor skipped is the failure this app exists to prevent,
 * and it is only findable if the whole document is on the screen.
 */
export function ProvenanceView({
  document: lines,
  entries,
  sourceName,
}: {
  readonly document: readonly string[];
  readonly entries: readonly ExtractedEntry[];
  readonly sourceName: string | null;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const marked = useRef<HTMLDivElement | null>(null);

  const chosen = entries.find((e) => e.index === selected) ?? null;
  const sourceLine = chosen?.line ?? null;

  useEffect(() => {
    marked.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [sourceLine]);

  /** The extracted line a document row produced, if it produced one. */
  const producedBy = (row: number) => entries.find((e) => e.line === row) ?? null;

  const mapped = entries.some((e) => e.line !== null);
  /*
    No lines at all is not the same as lines whose provenance was lost.

    Both arrive here with nothing mapped, and both used to be explained as "the
    enquiry text was corrected after this file was read" — which, for a document
    the reader could make nothing of, is simply untrue. Nobody corrected
    anything; there was never a line to trace.
  */
  const nothingRead = entries.length === 0;

  return (
    <div>
      <p style={{ ...note, padding: '0 var(--cell-pad-x) 8px' }}>
        {mapped
          ? 'Select a line on either side and its counterpart is marked. Dimmer type is a row the reader left out — a covering letter left out is noise, a cable line left out is the thing to catch here.'
          : nothingRead
            ? 'No cable line was read from this document, so there is nothing to trace back to it. The text is here to read and to paste from — “Correct the text” below takes whatever you put in and prices it.'
            : 'The enquiry text was corrected after this file was read, so the app no longer knows which row each line came from. It will not guess: line positions moved, and provenance pointing at the wrong row is worse than none.'}
      </p>

      <div className="flex" style={{ borderTop: '1px solid var(--color-line-strong)' }}>
        {/* ── The document ──────────────────────────────────────────────── */}
        <div className="min-w-0 flex-1" style={{ borderRight: '1px solid var(--color-line-hairline)' }}>
          <Heading>{sourceName ?? 'The document'}</Heading>
          <div style={pane}>
            {lines.map((text, row) => {
              const produced = producedBy(row);
              const isSource = sourceLine === row;
              return (
                <div
                  key={row}
                  ref={isSource ? marked : null}
                  onClick={produced === null ? undefined : () => setSelected(produced.index)}
                  style={{
                    display: 'flex',
                    gap: 8,
                    padding: '2px 10px 2px 0',
                    borderLeft: isSource
                      ? '2px solid var(--color-copper)'
                      : '2px solid transparent',
                    cursor: produced === null ? 'default' : 'pointer',
                  }}
                >
                  <span
                    className="numeric"
                    style={{
                      width: 44,
                      flexShrink: 0,
                      textAlign: 'right',
                      color: 'var(--color-ink-tertiary)',
                      fontSize: 'var(--text-micro)',
                    }}
                  >
                    {row + 1}
                  </span>
                  <span
                    style={{
                      // Tabs are how a spreadsheet row arrives here; rendering
                      // them as spaces would run two cells into one word.
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      fontSize: 'var(--text-micro)',
                      lineHeight: 'var(--text-micro--line-height)',
                      color:
                        produced === null
                          ? 'var(--color-ink-tertiary)'
                          : 'var(--color-ink-primary)',
                    }}
                  >
                    {text === '' ? ' ' : text.replace(/\t/g, '   ')}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── What was read out of it ───────────────────────────────────── */}
        <div className="min-w-0 flex-1">
          <Heading>Read as {entries.length} line{entries.length === 1 ? '' : 's'}</Heading>
          <div style={pane}>
            {entries.map((e) => {
              const isSelected = e.index === selected;
              return (
                <div
                  key={e.index}
                  onClick={() => setSelected(isSelected ? null : e.index)}
                  style={{
                    padding: '4px 10px',
                    borderLeft: isSelected
                      ? '2px solid var(--color-copper)'
                      : '2px solid transparent',
                    cursor: 'pointer',
                  }}
                >
                  <div
                    style={{
                      fontSize: 'var(--text-micro)',
                      lineHeight: 'var(--text-micro--line-height)',
                      color: 'var(--color-ink-primary)',
                    }}
                  >
                    {e.text}
                  </div>
                  <div
                    className="numeric"
                    style={{
                      color: 'var(--color-ink-tertiary)',
                      fontSize: 'var(--text-micro)',
                      textAlign: 'left',
                    }}
                  >
                    {e.line === null ? 'source unknown' : e.where}
                  </div>
                </div>
              );
            })}
            {entries.length === 0 ? (
              <p style={{ ...note, padding: 10 }}>Nothing was read from this file.</p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function Heading({ children }: { readonly children: React.ReactNode }) {
  return (
    <div
      className="label"
      style={{
        padding: '6px 12px',
        borderBottom: '1px solid var(--color-line-hairline)',
        backgroundColor: 'var(--color-surface-panel)',
      }}
    >
      {children}
    </div>
  );
}

const pane: React.CSSProperties = {
  maxHeight: 420,
  overflowY: 'auto',
  paddingTop: 4,
  paddingBottom: 4,
};

const note: React.CSSProperties = {
  color: 'var(--color-ink-secondary)',
  fontSize: 'var(--text-micro)',
  lineHeight: 'var(--text-micro--line-height)',
  maxWidth: 680,
};
