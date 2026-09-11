import { toUnixSeconds } from './time.js';
import type { Candle } from './types.js';

/**
 * Merges `incoming` into `existing`, de-duplicating by normalized time
 * (incoming wins on conflict — it's the freshly-fetched source of truth)
 * and returns a fully re-sorted ascending array.
 *
 * Overlap is expected, not an edge case: a loader asked for "everything
 * before time T" may reasonably return a batch that laps back over
 * candles the chart already has, and the caller shouldn't have to worry
 * about trimming it exactly.
 */
export function mergeCandles(existing: Candle[], incoming: Candle[]): Candle[] {
  const byTime = new Map<number, Candle>();
  for (const c of existing) byTime.set(toUnixSeconds(c.time), c);
  for (const c of incoming) byTime.set(toUnixSeconds(c.time), c);
  return Array.from(byTime.values()).sort((a, b) => toUnixSeconds(a.time) - toUnixSeconds(b.time));
}
