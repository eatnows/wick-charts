import { describe, expect, it } from 'vitest';
import { lineSeries } from './line';
import { getSeries } from './registry';
import { createFakeContext } from '../testHelpers';
import type { SeriesDrawContext } from './types';
import type { LinePoint } from '../types';
import type { FakeContext2D } from '../testHelpers';

function point(time: number, value: number): LinePoint {
  return { time, value };
}

/** A no-op identity Scale — draw()'s coordinate math still runs through
 * it, but these tests only care about path/gap behavior, so an identity
 * mapping keeps the numbers easy to reason about (mirrors
 * candlestick.test.ts's own identityScale). */
function identityScale() {
  return { map: (v: number) => v, mapMany: (vs: number[]) => vs };
}

function drawContext(visible: LinePoint[], ctx: FakeContext2D): SeriesDrawContext<LinePoint> {
  return {
    ctx: ctx as unknown as CanvasRenderingContext2D,
    visible,
    startIndex: 0,
    xForIndex: (i) => i * 10,
    slotWidth: 10,
    yScale: identityScale(),
    chartHeight: 100,
    devicePixelRatio: 1,
  };
}

describe('lineSeries', () => {
  it('registers itself under "line" as a module-load side effect', () => {
    expect(getSeries('line')).toBe(lineSeries);
  });

  describe('getValueRange', () => {
    it('fits around the min/max value across visible points', () => {
      const range = lineSeries.getValueRange([point(1, 10), point(2, 25), point(3, 5)], 1);
      expect(range.min).toBe(5);
      expect(range.max).toBe(25);
    });

    it('widens proportionally to the scale factor', () => {
      const range = lineSeries.getValueRange([point(1, 90), point(2, 110)], 2);
      // mid = 100, raw half-span = 10, scaled half-span = 20
      expect(range.min).toBe(80);
      expect(range.max).toBe(120);
    });

    it('ignores non-finite (gap) values when fitting the range', () => {
      const range = lineSeries.getValueRange([point(1, NaN), point(2, 10), point(3, 20)], 1);
      expect(range.min).toBe(10);
      expect(range.max).toBe(20);
    });

    it('falls back to a fixed [0, 1] range when every visible value is a gap', () => {
      const range = lineSeries.getValueRange([point(1, NaN), point(2, NaN)], 1);
      expect(range).toEqual({ min: 0, max: 1 });
    });
  });

  describe('formatLegend', () => {
    it('formats a finite value', () => {
      const parts = lineSeries.formatLegend!(point(1, 12345.6), lineSeries.defaultStyle);
      expect(parts).toEqual(['Value 12,345.6']);
    });

    it('shows a placeholder for a gap (NaN) point instead of "Value NaN"', () => {
      const parts = lineSeries.formatLegend!(point(1, NaN), lineSeries.defaultStyle);
      expect(parts).toEqual(['Value —']);
    });
  });

  describe('draw', () => {
    it('draws one continuous path through every finite point', () => {
      const ctx = createFakeContext();
      const visible = [point(1, 10), point(2, 20), point(3, 15)];

      lineSeries.draw(drawContext(visible, ctx), lineSeries.defaultStyle);

      expect(ctx.moveTo).toHaveBeenCalledTimes(1);
      expect(ctx.moveTo).toHaveBeenCalledWith(0, 10);
      expect(ctx.lineTo).toHaveBeenCalledTimes(2);
      expect(ctx.lineTo).toHaveBeenNthCalledWith(1, 10, 20);
      expect(ctx.lineTo).toHaveBeenNthCalledWith(2, 20, 15);
      expect(ctx.stroke).toHaveBeenCalledTimes(1);
    });

    it('breaks the path at a gap and resumes at the next finite point', () => {
      const ctx = createFakeContext();
      const visible = [point(1, 10), point(2, NaN), point(3, 20)];

      lineSeries.draw(drawContext(visible, ctx), lineSeries.defaultStyle);

      // one moveTo before the gap, one moveTo resuming after it — no
      // lineTo ever spans across the NaN point.
      expect(ctx.moveTo).toHaveBeenCalledTimes(2);
      expect(ctx.moveTo).toHaveBeenNthCalledWith(1, 0, 10);
      expect(ctx.moveTo).toHaveBeenNthCalledWith(2, 20, 20);
      expect(ctx.lineTo).not.toHaveBeenCalled();
    });

    it('does nothing when there are no visible points', () => {
      const ctx = createFakeContext();
      lineSeries.draw(drawContext([], ctx), lineSeries.defaultStyle);
      expect(ctx.beginPath).not.toHaveBeenCalled();
      expect(ctx.stroke).not.toHaveBeenCalled();
    });

    it('applies lineColor/lineWidth from style', () => {
      const ctx = createFakeContext();
      const style = { lineColor: '#ff00ff', lineWidth: 3 };
      lineSeries.draw(drawContext([point(1, 10), point(2, 20)], ctx), style);
      expect(ctx.strokeStyle).toBe('#ff00ff');
      expect(ctx.lineWidth).toBe(3);
    });

    it('scales lineWidth by devicePixelRatio, since it is authored in CSS pixels', () => {
      const ctx = createFakeContext();
      const style = { lineColor: '#ff00ff', lineWidth: 3 };
      const context = { ...drawContext([point(1, 10), point(2, 20)], ctx), devicePixelRatio: 2 };
      lineSeries.draw(context, style);
      expect(ctx.lineWidth).toBe(6);
    });
  });
});
