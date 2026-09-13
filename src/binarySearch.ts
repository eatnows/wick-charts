/**
 * Binary search over an ascending-sorted number array — extracted out of
 * `WickChart` since it's pure array math with no dependency on chart state,
 * used by `setVisibleTimeRange` to resolve a time to its index.
 */

/** First index in `values` (ascending) whose value is `>= target`, or
 * `values.length` if every value is smaller — the standard binary
 * lower-bound, O(log n) rather than a linear scan over what can be a
 * multi-thousand-point loaded series. */
export function lowerBound(values: number[], target: number): number {
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (values[mid]! < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** First index in `values` (ascending) whose value is `> target`, or
 * `values.length` if none is — the exclusive end boundary for an inclusive
 * upper bound, so a range `[lowerBound(from), upperBound(to))` includes
 * every value in `[from, to]` inclusive on both ends. */
export function upperBound(values: number[], target: number): number {
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (values[mid]! <= target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
