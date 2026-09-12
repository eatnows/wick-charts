import { describe, expect, it } from 'vitest';
import { createMovingAveragePlugin } from './movingAverage';
import { createFakeContext } from '../testHelpers';
import type { PluginRenderApi } from '../plugins/types';
import type { Candle } from '../types';
import type { FakeContext2D } from '../testHelpers';

function candle(time: number, close: number, high = close): Candle {
  return { time, open: close, high, low: close, close };
}

function fakeApi(
  allPoints: Candle[],
  visibleStartIndex: number,
  visibleEndIndex: number,
  ctx: FakeContext2D,
): PluginRenderApi<Candle> {
  return {
    ctx: ctx as unknown as CanvasRenderingContext2D,
    chartWidth: 800,
    chartHeight: 400,
    xForIndex: (i) => i * 10,
    yForValue: (v) => 400 - v,
    visibleStartIndex,
    visibleEndIndex,
    allPoints,
  };
}

describe('createMovingAveragePlugin', () => {
  it('draws nothing when there is no data', () => {
    const ctx = createFakeContext();
    const plugin = createMovingAveragePlugin();
    plugin.draw(fakeApi([], 0, 0, ctx));
    expect(ctx.beginPath).not.toHaveBeenCalled();
  });

  it('draws a continuous line over the non-warm-up portion of the visible range', () => {
    const ctx = createFakeContext();
    const points = Array.from({ length: 25 }, (_, i) => candle(i, 100 + i));
    const plugin = createMovingAveragePlugin(); // default period 20

    plugin.draw(fakeApi(points, 0, points.length, ctx));

    // period 20 over 25 points -> indices 0..18 are NaN (warm-up), 19..24 are valid (6 points):
    // one moveTo for the first valid point, then 5 lineTo calls for the rest.
    expect(ctx.moveTo).toHaveBeenCalledTimes(1);
    expect(ctx.lineTo).toHaveBeenCalledTimes(5);
    expect(ctx.stroke).toHaveBeenCalledOnce();
  });

  it('draws nothing when the entire visible range is still in the warm-up period', () => {
    const ctx = createFakeContext();
    const points = Array.from({ length: 25 }, (_, i) => candle(i, 100 + i));
    const plugin = createMovingAveragePlugin({ period: 20 });

    plugin.draw(fakeApi(points, 0, 10, ctx)); // all within the first 19 (NaN) indices

    expect(ctx.moveTo).not.toHaveBeenCalled();
    expect(ctx.lineTo).not.toHaveBeenCalled();
  });

  it('computes the average over allPoints, not just the visible slice, so a visible window past the warm-up still draws', () => {
    const ctx = createFakeContext();
    const points = Array.from({ length: 25 }, (_, i) => candle(i, 100 + i));
    const plugin = createMovingAveragePlugin({ period: 20 });

    // Only the last 5 points are "visible" — on their own, far too few for a
    // period-20 average — but indices 19..24 are already past warm-up when
    // computed over the full 25-point history.
    plugin.draw(fakeApi(points, 20, 25, ctx));

    expect(ctx.moveTo).toHaveBeenCalledTimes(1);
    expect(ctx.lineTo).toHaveBeenCalledTimes(4);
  });

  it('respects a custom period, color, lineWidth, and value accessor', () => {
    const ctx = createFakeContext();
    // period 1 makes the "average" exactly the accessed value at every index,
    // with no warm-up gap — easiest way to check exactly which values it read.
    const points = [candle(0, 100, 150), candle(1, 200, 250)];
    const plugin = createMovingAveragePlugin({
      period: 1,
      color: '#123456',
      lineWidth: 3,
      accessor: (c) => c.high,
    });

    plugin.draw(fakeApi(points, 0, 2, ctx));

    expect(ctx.strokeStyle).toBe('#123456');
    expect(ctx.lineWidth).toBe(3);
    // yForValue is `400 - v` in the fake api; high values are 150 and 250
    expect(ctx.moveTo).toHaveBeenCalledWith(0, 400 - 150);
    expect(ctx.lineTo).toHaveBeenCalledWith(10, 400 - 250);
  });
});
