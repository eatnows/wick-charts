import { describe, expect, it } from 'vitest';
import { candlestickSeries } from './candlestick';
import { getSeries } from './registry';
import { createFakeContext } from '../testHelpers';
import type { SeriesDrawContext } from './types';
import type { Candle } from '../types';
import type { FakeContext2D } from '../testHelpers';

function candle(time: number, open: number, high: number, low: number, close: number, volume?: number): Candle {
  return { time, open, high, low, close, volume };
}

/** A no-op identity Scale — draw()'s wick/body math still runs through it,
 * but these tests only care about volume-bar behavior, so an identity
 * mapping keeps the numbers easy to reason about. */
function identityScale() {
  return { map: (v: number) => v, mapMany: (vs: number[]) => vs };
}

function drawContext(visible: Candle[], ctx: FakeContext2D): SeriesDrawContext<Candle> {
  return {
    ctx: ctx as unknown as CanvasRenderingContext2D,
    visible,
    startIndex: 0,
    xForIndex: (i) => i * 10,
    slotWidth: 10,
    yScale: identityScale(),
    chartHeight: 100,
  };
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

  describe('draw — volume bars', () => {
    it('draws only wick+body fillRects when no visible candle has volume', () => {
      const ctx = createFakeContext();
      const visible = [candle(1, 100, 110, 95, 105), candle(2, 105, 115, 100, 110)];
      candlestickSeries.draw(drawContext(visible, ctx), candlestickSeries.defaultStyle);

      // one body fillRect per candle, zero volume bars
      expect(ctx.fillRect.mock.calls.length).toBe(visible.length);
    });

    it('draws one volume bar per candle that has volume, on top of the same fillRect count otherwise', () => {
      const ctx = createFakeContext();
      const visible = [candle(1, 100, 110, 95, 105, 50), candle(2, 105, 115, 100, 110, 100)];
      candlestickSeries.draw(drawContext(visible, ctx), candlestickSeries.defaultStyle);

      // 2 volume bars (drawn first) + 2 bodies (drawn after)
      expect(ctx.fillRect.mock.calls.length).toBe(4);
    });

    it('scales each bar against the largest visible volume, and resets globalAlpha afterward', () => {
      const ctx = createFakeContext();
      const visible = [candle(1, 100, 110, 95, 105, 50), candle(2, 105, 115, 100, 110, 100)];
      candlestickSeries.draw(drawContext(visible, ctx), candlestickSeries.defaultStyle);

      // volume bars are the first two fillRect calls (drawn before the candle bodies);
      // chartHeight=100, VOLUME_AREA_HEIGHT_RATIO=0.2 -> areaHeight=20
      const [, , , barHeightHalf] = ctx.fillRect.mock.calls[0] as [number, number, number, number];
      const [, , , barHeightFull] = ctx.fillRect.mock.calls[1] as [number, number, number, number];
      expect(barHeightHalf).toBeCloseTo(10); // 50/100 of areaHeight 20
      expect(barHeightFull).toBeCloseTo(20); // 100/100 of areaHeight 20
      expect(ctx.globalAlpha).toBe(1);
    });

    it('omits the bar for an individual candle that lacks volume even when others in view have it', () => {
      const ctx = createFakeContext();
      const visible = [candle(1, 100, 110, 95, 105, 100), candle(2, 105, 115, 100, 110)];
      candlestickSeries.draw(drawContext(visible, ctx), candlestickSeries.defaultStyle);

      // 1 volume bar (only the first candle has volume) + 2 bodies
      expect(ctx.fillRect.mock.calls.length).toBe(3);
    });

    it('respects a custom volumeAreaHeightRatio and volumeBarOpacity', () => {
      const ctx = createFakeContext();
      const visible = [candle(1, 100, 110, 95, 105, 100)];
      const style = { ...candlestickSeries.defaultStyle, volumeAreaHeightRatio: 0.5, volumeBarOpacity: 0.25 };
      let observedAlpha: number | undefined;
      ctx.fillRect.mockImplementation(() => {
        observedAlpha ??= ctx.globalAlpha; // capture alpha at the moment the bar is drawn
      });

      candlestickSeries.draw(drawContext(visible, ctx), style);

      // chartHeight=100 (see drawContext), ratio 0.5 -> areaHeight=50; volume is the
      // only (and therefore max) one, so the bar fills the whole area: height 50
      const [, , , barHeight] = ctx.fillRect.mock.calls[0] as [number, number, number, number];
      expect(barHeight).toBeCloseTo(50);
      expect(observedAlpha).toBe(0.25);
    });
  });

  describe('customizable style: bodyWidthRatio', () => {
    it('widens the candle body/volume-bar width with a larger bodyWidthRatio', () => {
      const ctx = createFakeContext();
      const visible = [candle(1, 100, 110, 95, 105, 100)];
      const wideStyle = { ...candlestickSeries.defaultStyle, bodyWidthRatio: 0.9 };

      candlestickSeries.draw(drawContext(visible, ctx), wideStyle);

      // drawContext uses slotWidth: 10 -> default ratio 0.6 gives width 6, this ratio gives 9
      const [, , volumeBarWidth] = ctx.fillRect.mock.calls[0] as [number, number, number, number];
      const [, , bodyWidth] = ctx.fillRect.mock.calls[1] as [number, number, number, number];
      expect(volumeBarWidth).toBeCloseTo(9);
      expect(bodyWidth).toBeCloseTo(9);
    });
  });
});
