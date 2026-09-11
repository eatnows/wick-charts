import { describe, expect, it } from 'vitest';
import { candlestickSeries } from './candlestick';
import { getSeries } from './registry';
import type { Candle } from '../types';

function candle(time: number, open: number, high: number, low: number, close: number, volume?: number): Candle {
  return { time, open, high, low, close, volume };
}

describe('candlestickSeries', () => {
  it('registers itself under "candlestick" as a module-load side effect', () => {
    expect(getSeries('candlestick')).toBe(candlestickSeries);
  });

  describe('getValueRange', () => {
    it('fits around the highest high and lowest low across visible candles', () => {
      const range = candlestickSeries.getValueRange(
        [candle(1, 100, 110, 95, 105), candle(2, 105, 120, 90, 92)],
        1,
      );
      expect(range.min).toBe(90);
      expect(range.max).toBe(120);
    });

    it('widens proportionally to the scale factor', () => {
      const range = candlestickSeries.getValueRange([candle(1, 100, 110, 90, 105)], 2);
      // mid = 100, raw half-span = 10, scaled half-span = 20
      expect(range.min).toBe(80);
      expect(range.max).toBe(120);
    });
  });

  describe('formatLegend', () => {
    it('includes O/H/L/C but not volume when the candle has none', () => {
      const parts = candlestickSeries.formatLegend!(candle(1, 100, 110, 95, 105), candlestickSeries.defaultStyle);
      expect(parts.some((p) => p.startsWith('O '))).toBe(true);
      expect(parts.some((p) => p.startsWith('H '))).toBe(true);
      expect(parts.some((p) => p.startsWith('L '))).toBe(true);
      expect(parts.some((p) => p.startsWith('C '))).toBe(true);
      expect(parts.some((p) => p.startsWith('Vol'))).toBe(false);
    });

    it('appends volume when the candle has it', () => {
      const parts = candlestickSeries.formatLegend!(
        candle(1, 100, 110, 95, 105, 12345),
        candlestickSeries.defaultStyle,
      );
      expect(parts.some((p) => p.startsWith('Vol') && p.includes('12,345'))).toBe(true);
    });
  });
});
