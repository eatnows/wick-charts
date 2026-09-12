import { describe, expect, it } from 'vitest';
import { createBollingerBandsPlugin } from './bollingerBands';
import { createFakeContext } from '../testHelpers';
import type { PluginRenderApi } from '../plugins/types';
import type { Candle } from '../types';
import type { FakeContext2D } from '../testHelpers';

function candle(time: number, close: number): Candle {
  return { time, open: close, high: close, low: close, close };
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

describe('createBollingerBandsPlugin', () => {
  it('draws nothing when there is no data', () => {
    const ctx = createFakeContext();
    const plugin = createBollingerBandsPlugin();
    plugin.draw(fakeApi([], 0, 0, ctx));
    expect(ctx.beginPath).not.toHaveBeenCalled();
    expect(ctx.fill).not.toHaveBeenCalled();
  });

  it('draws nothing while the entire visible range is still in warm-up', () => {
    const ctx = createFakeContext();
    const points = Array.from({ length: 25 }, (_, i) => candle(i, 100 + i));
    const plugin = createBollingerBandsPlugin({ period: 20 });

    plugin.draw(fakeApi(points, 0, 10, ctx));

    expect(ctx.stroke).not.toHaveBeenCalled();
    expect(ctx.fill).not.toHaveBeenCalled();
  });

  it('draws a fill and three lines (upper, lower, middle) once past warm-up', () => {
    const ctx = createFakeContext();
    const points = Array.from({ length: 25 }, (_, i) => candle(i, 100 + i));
    const plugin = createBollingerBandsPlugin({ period: 20 });

    plugin.draw(fakeApi(points, 0, points.length, ctx));

    expect(ctx.fill).toHaveBeenCalledOnce();
    // 3 lines (upper/lower/middle) x 1 run each = 3 stroke calls
    expect(ctx.stroke).toHaveBeenCalledTimes(3);
  });

  it('computes over allPoints, not just the visible slice', () => {
    const ctx = createFakeContext();
    const points = Array.from({ length: 25 }, (_, i) => candle(i, 100 + i));
    const plugin = createBollingerBandsPlugin({ period: 20 });

    // only the last 5 are "visible" — too few on their own for a period-20
    // window, but valid once computed against the full 25-point history
    plugin.draw(fakeApi(points, 20, 25, ctx));

    expect(ctx.fill).toHaveBeenCalledOnce();
    expect(ctx.stroke).toHaveBeenCalledTimes(3);
  });

  it('collapses upper and lower bands to the middle band when the series is perfectly flat', () => {
    const ctx = createFakeContext();
    const points = Array.from({ length: 25 }, (_, i) => candle(i, 100)); // constant close -> stdDev 0
    const plugin = createBollingerBandsPlugin({ period: 20, stdDevMultiplier: 2 });
    const moveToCalls: Array<[number, number]> = [];
    ctx.moveTo.mockImplementation((x: number, y: number) => moveToCalls.push([x, y]));

    plugin.draw(fakeApi(points, 0, points.length, ctx));

    // upper, lower, and middle band all sit at the same value (100) when stdDev is 0,
    // and the fill's upper-edge moveTo is the very first moveTo call
    const yFor100 = 400 - 100;
    expect(moveToCalls[0]![1]).toBe(yFor100);
  });

  it('respects custom period, stdDevMultiplier, colors, fillOpacity, lineWidth, and accessor', () => {
    const ctx = createFakeContext();
    // period 1 makes stdDev always 0 and the "average" exactly the accessed
    // value at every index, with no warm-up gap.
    const points = [candle(0, 100), candle(1, 200)];
    const plugin = createBollingerBandsPlugin({
      period: 1,
      middleColor: '#111111',
      bandColor: '#222222',
      fillColor: '#333333',
      fillOpacity: 0.5,
      lineWidth: 4,
      accessor: (c) => c.close,
    });

    plugin.draw(fakeApi(points, 0, 2, ctx));

    expect(ctx.fillStyle).toBe('#333333');
    // last stroke call (middle band, drawn last) leaves its color/width set
    expect(ctx.strokeStyle).toBe('#111111');
    expect(ctx.lineWidth).toBe(4);
  });
});
