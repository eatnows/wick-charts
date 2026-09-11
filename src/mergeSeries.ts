import { toUnixSeconds } from './time.js';
import type { SeriesPoint } from './types.js';

/**
 * Merges `incoming` into `existing`, de-duplicating by normalized time
 * (incoming wins on conflict — it's the freshly-fetched source of truth)
 * and returns a fully re-sorted ascending array. Generic over any point
 * shape with a `time` field, not just `Candle` — a future series type
 * reuses this unchanged.
 *
 * Overlap is expected, not an edge case: a loader asked for "everything
 * before time T" may reasonably return a batch that laps back over points
 * the chart already has, and the caller shouldn't have to worry about
 * trimming it exactly.
 */
export function mergeSeriesPoints<TPoint extends SeriesPoint>(existing: TPoint[], incoming: TPoint[]): TPoint[] {
  const byTime = new Map<number, TPoint>();
  for (const p of existing) byTime.set(toUnixSeconds(p.time), p);
  for (const p of incoming) byTime.set(toUnixSeconds(p.time), p);
  return Array.from(byTime.values()).sort((a, b) => toUnixSeconds(a.time) - toUnixSeconds(b.time));
}
