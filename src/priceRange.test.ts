import { describe, expect, it } from 'vitest';
import { autoFitPriceRange } from './priceRange';
import type { Candle } from './types';

function candle(low: number, high: number): Candle {
  return { time: 0, open: low, high, low, close: high };
}

describe('autoFitPriceRange', () => {
  it('fits tightly around visible highs/lows at scale factor 1', () => {
    const range = autoFitPriceRange([candle(90, 110), candle(95, 120)], 1);
    expect(range.min).toBe(90);
    expect(range.max).toBe(120);
  });

  it('widens the range proportionally to the scale factor', () => {
    const range = autoFitPriceRange([candle(90, 110)], 2);
    // mid = 100, raw half-span = 10, scaled half-span = 20
    expect(range.min).toBe(80);
    expect(range.max).toBe(120);
  });

  it('falls back to a non-zero span when every visible candle is flat', () => {
    const range = autoFitPriceRange([candle(100, 100)], 1);
    expect(range.max).toBeGreaterThan(range.min);
  });
});
