import type { Candle } from './types.js';

export interface PriceRange {
  min: number;
  max: number;
}

/** Computes the default (auto-fit) price range from the candles currently
 * on screen, widened/narrowed by `priceScaleFactor`. This is what the
 * renderer falls back to until the user manually pans/scales the price
 * axis — see `Viewport.priceRangeOverride`. */
export function autoFitPriceRange(visible: Candle[], priceScaleFactor: number): PriceRange {
  const rawMin = Math.min(...visible.map((c) => c.low));
  const rawMax = Math.max(...visible.map((c) => c.high));
  const mid = (rawMin + rawMax) / 2;
  const rawHalfSpan = (rawMax - rawMin) / 2 || Math.abs(mid) * 0.01 || 1;
  const halfSpan = rawHalfSpan * priceScaleFactor;
  return { min: mid - halfSpan, max: mid + halfSpan };
}
