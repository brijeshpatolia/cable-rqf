import type { Decimal } from '@/core/decimal';
import { formatInstant, formatNumber } from '@/core/format';

/**
 * The copper ticker, in the top bar.
 *
 * Copper is the number this whole app moves around, and it used to live in a
 * panel on one screen. Putting it in the bar means an engineer pricing a job
 * can see the market they are pricing against without navigating away — which
 * is the difference between a tool that reports copper and one that is
 * *about* copper.
 *
 * **The number never moves.** No counting, no rolling, no sliding. When a tick
 * arrives the wash flashes behind the digits and fades over 600ms. A figure
 * that animates is a figure you cannot read at the moment it changes, which is
 * exactly the moment you want to read it.
 *
 * Server-rendered, including the sparkline: the series is a handful of daily
 * closes the server already has, and shipping a charting library to draw 23
 * points would be the most expensive thing on the page.
 */

export interface TickerSeries {
  readonly points: readonly number[];
  readonly lme: Decimal;
  readonly asOf: Date;
}

/**
 * How many closes it takes before a line is worth drawing.
 *
 * Two points always make a perfectly straight diagonal, and a straight
 * diagonal reads as a trend — the eye takes it as "copper has been climbing
 * steadily", when all it says is "there are two numbers and one is bigger".
 * On a screen whose entire argument is that a figure carries its provenance,
 * inventing a slope out of two readings is the worst thing this component
 * could do. Below the threshold it draws nothing and the figure stands alone,
 * which is honest and costs the layout nothing.
 */
const ENOUGH_TO_PLOT = 5;

/**
 * The polyline, normalised to the series' own range.
 *
 * A 2px vertical inset so the stroke and the end dot are never clipped by the
 * viewbox.
 */
function path(points: readonly number[], w: number, h: number, inset = 2): string | null {
  if (points.length < ENOUGH_TO_PLOT) return null;

  const low = Math.min(...points);
  const high = Math.max(...points);
  const span = high - low;
  const usable = h - inset * 2;

  return points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * w;
      // A flat series sits on the centre line rather than dividing by zero.
      const y = span === 0 ? h / 2 : inset + (1 - (p - low) / span) * usable;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');
}

export function Ticker({ points, lme, asOf }: TickerSeries) {
  const W = 96;
  const H = 26;
  const line = path(points, W, H);
  const last = line?.split(' ').at(-1)?.split(',');

  return (
    <div className="flex items-center" style={{ marginLeft: 'auto', gap: 16 }}>
      {line === null ? null : (
        <svg
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          aria-hidden
          style={{ display: 'block', overflow: 'visible' }}
        >
          <polyline
            points={line}
            fill="none"
            stroke="var(--color-copper)"
            strokeWidth={1.25}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {last === undefined ? null : (
            <circle cx={last[0]} cy={last[1]} r={2} fill="var(--color-copper)" />
          )}
        </svg>
      )}

      <div className="flex items-baseline" style={{ gap: 8 }}>
        <span className="label">LME Cu</span>
        <span
          className="numeric copper-tick"
          style={{
            color: 'var(--color-copper)',
            fontSize: 'var(--text-ticker)',
            fontWeight: 500,
            letterSpacing: '-0.01em',
          }}
        >
          {formatNumber(lme, 2)}
        </span>
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: 'var(--color-ink-secondary)',
          }}
        >
          USD/t
        </span>
      </div>

      <div
        aria-hidden
        style={{ width: 1, height: 22, backgroundColor: 'var(--color-line-panel)' }}
      />

      {/* Absolute, with a timezone. Never "2 hours ago". */}
      <span
        className="numeric"
        style={{
          fontSize: 'var(--text-mono-micro)',
          color: 'var(--color-ink-tertiary)',
          whiteSpace: 'nowrap',
        }}
      >
        {formatInstant(asOf)}
      </span>
    </div>
  );
}
