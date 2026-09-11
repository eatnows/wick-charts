import type { ValueRange } from './types.js';

/**
 * Widens/narrows a raw [min, max] domain around its center by
 * `scaleFactor`, with a floor so a flat or single-point series still gets
 * a visible span instead of collapsing to zero height. This is the shared
 * "auto-fit + manual zoom" math every series's `getValueRange` needs —
 * only how a series derives its own raw min/max (candlestick: high/low
 * across visible candles; a future line series: min/max of `.value`)
 * differs between series types, so that part lives in each series
 * definition instead of here. See `src/series/candlestick.ts` for a caller.
 */
export function fitRange(rawMin: number, rawMax: number, scaleFactor: number): ValueRange {
  const mid = (rawMin + rawMax) / 2;
  const rawHalfSpan = (rawMax - rawMin) / 2 || Math.abs(mid) * 0.01 || 1;
  const halfSpan = rawHalfSpan * scaleFactor;
  return { min: mid - halfSpan, max: mid + halfSpan };
}
