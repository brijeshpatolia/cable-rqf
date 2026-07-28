import { describe, expect, it } from 'vitest';
import { nextRadioIndex } from './JobsTable';

/*
  The status filter is a radiogroup with a roving `tabIndex`, which means the
  three unselected segments carry `tabIndex={-1}` and are reachable by keyboard
  only through the arrows. This covers the arithmetic that does the reaching.
*/

/** The four segments: All, In review, Quoted, Closed. */
const N = 4;

describe('nextRadioIndex', () => {
  it('steps forward and back', () => {
    expect(nextRadioIndex('ArrowRight', 0, N)).toBe(1);
    expect(nextRadioIndex('ArrowLeft', 2, N)).toBe(1);
  });

  it('treats the vertical arrows the same, because the group is one control', () => {
    expect(nextRadioIndex('ArrowDown', 0, N)).toBe(1);
    expect(nextRadioIndex('ArrowUp', 1, N)).toBe(0);
  });

  it('wraps at both ends rather than stopping', () => {
    expect(nextRadioIndex('ArrowRight', N - 1, N)).toBe(0);
    expect(nextRadioIndex('ArrowLeft', 0, N)).toBe(N - 1);
  });

  it('jumps to the ends with Home and End', () => {
    expect(nextRadioIndex('Home', 2, N)).toBe(0);
    expect(nextRadioIndex('End', 0, N)).toBe(N - 1);
  });

  it('declines every other key, so typing and Tab still behave', () => {
    for (const key of ['Tab', 'Enter', ' ', 'a', 'Escape', 'PageDown']) {
      expect(nextRadioIndex(key, 0, N)).toBeNull();
    }
  });

  it('reaches every segment from every segment', () => {
    /*
      The property that matters, stated directly: no segment is stranded. A
      wrapping bug at one end would leave a segment unreachable in one
      direction, which is the defect this whole handler exists to prevent.
    */
    for (let from = 0; from < N; from += 1) {
      const forward = new Set<number>();
      let at = from;
      for (let step = 0; step < N; step += 1) {
        at = nextRadioIndex('ArrowRight', at, N)!;
        forward.add(at);
      }
      expect(forward.size).toBe(N);
    }
  });
});
