/**
 * Walks `[start, end)` and calls `callback` once per maximal contiguous run
 * of indices where `isValid` holds — the "gap" pattern every indicator
 * overlay shares: a moving average or Bollinger Bands can't draw a line
 * straight through its own NaN warm-up region (or any other hole in the
 * data), so each valid stretch becomes its own subpath/polygon instead of
 * one continuous line that would misleadingly connect across the gap.
 */
export function forEachValidRun(
  start: number,
  end: number,
  isValid: (index: number) => boolean,
  callback: (runStart: number, runEnd: number) => void,
): void {
  let runStart = -1;
  for (let i = start; i <= end; i++) {
    const valid = i < end && isValid(i);
    if (valid && runStart === -1) runStart = i;
    if (!valid && runStart !== -1) {
      callback(runStart, i);
      runStart = -1;
    }
  }
}
