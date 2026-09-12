import { describe, expect, it } from 'vitest';
import { forEachValidRun } from './runs';

function collectRuns(start: number, end: number, isValid: (i: number) => boolean): Array<[number, number]> {
  const runs: Array<[number, number]> = [];
  forEachValidRun(start, end, isValid, (runStart, runEnd) => runs.push([runStart, runEnd]));
  return runs;
}

describe('forEachValidRun', () => {
  it('reports one run spanning the whole range when everything is valid', () => {
    expect(collectRuns(0, 5, () => true)).toEqual([[0, 5]]);
  });

  it('reports no runs when nothing is valid', () => {
    expect(collectRuns(0, 5, () => false)).toEqual([]);
  });

  it('splits into separate runs around a gap', () => {
    const invalid = new Set([2]);
    expect(collectRuns(0, 5, (i) => !invalid.has(i))).toEqual([
      [0, 2],
      [3, 5],
    ]);
  });

  it('handles a leading warm-up gap (the common indicator case)', () => {
    expect(collectRuns(0, 10, (i) => i >= 6)).toEqual([[6, 10]]);
  });

  it('handles a trailing run cut off by the visible window ending mid-run', () => {
    expect(collectRuns(0, 5, () => true)).toEqual([[0, 5]]); // the run's own end is exclusive, not a gap
  });

  it('reports nothing for an empty range', () => {
    expect(collectRuns(3, 3, () => true)).toEqual([]);
  });
});
