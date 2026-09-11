// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { ChartRenderer } from './renderer';
import { candlestickSeries } from './series/candlestick';
import { createTestCanvas } from './testHelpers';
import { Viewport } from './viewport';
import type { Candle } from './types';
import type { FakeContext2D } from './testHelpers';

function candle(time: number, open: number, high: number, low: number, close: number): Candle {
  return { time, open, high, low, close };
}

const SAMPLE: Candle[] = [
  candle(1, 100, 110, 95, 105),
  candle(2, 105, 108, 90, 92), // down candle
  candle(3, 92, 130, 88, 120),
];
const TIMES = SAMPLE.map((c) => c.time as number);

describe('ChartRenderer (candlestick)', () => {
  let canvas: HTMLCanvasElement;
  let ctx: FakeContext2D;

  beforeEach(() => {
    ({ canvas, ctx } = createTestCanvas(800, 400));
  });

  it('throws a clear error when the canvas has no 2D context', () => {
    const { canvas: bad } = createTestCanvas();
    (bad.getContext as unknown as { mockReturnValue: (v: unknown) => void }).mockReturnValue(null);
    expect(() => new ChartRenderer(bad, candlestickSeries)).toThrow(/2d context/i);
  });

  it('exposes chartWidth/chartHeight excluding the price and time axis strips', () => {
    const renderer = new ChartRenderer(canvas, candlestickSeries);
    // constants: PRICE_AXIS_WIDTH=64, TIME_AXIS_HEIGHT=24 (see renderer.ts)
    expect(renderer.chartWidth).toBe(800 - 64);
    expect(renderer.chartHeight).toBe(400 - 24);
    expect(renderer.priceAxisWidth).toBe(64);
  });

  it('clears the canvas and draws nothing else for an empty series', () => {
    const renderer = new ChartRenderer(canvas, candlestickSeries);
    const viewport = new Viewport(0);
    renderer.render({ sorted: [], times: [], viewport, hoverIndex: null, plugins: [] });

    expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, 800, 400);
    expect(ctx.fillRect).not.toHaveBeenCalled();
    expect(ctx.stroke).not.toHaveBeenCalled();
  });

  it('fills the background when a non-transparent color is configured', () => {
    const renderer = new ChartRenderer(canvas, candlestickSeries, { background: '#111111' });
    renderer.render({ sorted: [], times: [], viewport: new Viewport(0), hoverIndex: null, plugins: [] });
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 800, 400);
  });

  it('draws one wick (stroke) and one body (fillRect) per visible candle', () => {
    const renderer = new ChartRenderer(canvas, candlestickSeries);
    const viewport = new Viewport(SAMPLE.length);
    renderer.render({ sorted: SAMPLE, times: TIMES, viewport, hoverIndex: null, plugins: [] });

    expect(ctx.stroke.mock.calls.length).toBeGreaterThanOrEqual(SAMPLE.length);
    // one body fillRect per candle, plus zero or more axis fills (background is transparent here)
    const bodyFills = ctx.fillRect.mock.calls.length;
    expect(bodyFills).toBe(SAMPLE.length);
  });

  it('does not draw candles when the chart area has no usable width', () => {
    const { canvas: tiny, ctx: tinyCtx } = createTestCanvas(10, 400); // narrower than the 64px price axis
    const renderer = new ChartRenderer(tiny, candlestickSeries);
    renderer.render({ sorted: SAMPLE, times: TIMES, viewport: new Viewport(SAMPLE.length), hoverIndex: null, plugins: [] });
    expect(tinyCtx.fillRect).not.toHaveBeenCalled();
  });

  it('draws a crosshair and an OHLC legend only when hoverIndex is inside the visible range', () => {
    const renderer = new ChartRenderer(canvas, candlestickSeries);
    const viewport = new Viewport(SAMPLE.length);

    renderer.render({ sorted: SAMPLE, times: TIMES, viewport, hoverIndex: null, plugins: [] });
    const fillTextCallsWithoutHover = ctx.fillText.mock.calls.length;
    ctx.fillText.mockClear();

    renderer.render({ sorted: SAMPLE, times: TIMES, viewport, hoverIndex: 1, plugins: [] });
    const fillTextCallsWithHover = ctx.fillText.mock.calls.length;

    // the legend adds exactly one more fillText call (the OHLC line) versus the no-hover render
    expect(fillTextCallsWithHover).toBe(fillTextCallsWithoutHover + 1);

    const legendCall = ctx.fillText.mock.calls[ctx.fillText.mock.calls.length - 1] as [string, number, number];
    expect(legendCall[0]).toContain('O ');
    expect(legendCall[0]).toContain('C ');
  });

  it('includes volume in the legend only when the hovered candle has it', () => {
    const renderer = new ChartRenderer(canvas, candlestickSeries);
    const withVolume: Candle = { ...SAMPLE[0]!, volume: 12345 };
    renderer.render({
      sorted: [withVolume],
      times: [1],
      viewport: new Viewport(1),
      hoverIndex: 0,
      plugins: [],
    });
    const [legendText] = ctx.fillText.mock.calls[ctx.fillText.mock.calls.length - 1] as [string];
    expect(legendText).toContain('Vol');
  });

  it('renders price-axis tick labels', () => {
    const renderer = new ChartRenderer(canvas, candlestickSeries);
    renderer.render({ sorted: SAMPLE, times: TIMES, viewport: new Viewport(SAMPLE.length), hoverIndex: null, plugins: [] });
    // price ticks are formatted with toLocaleString-free comma grouping via formatPrice;
    // just assert at least one fillText call looks like a plain number label.
    const texts = ctx.fillText.mock.calls.map((call) => call[0] as string);
    expect(texts.some((t) => /^-?[\d,.]+$/.test(t))).toBe(true);
  });

  it('renders time-axis tick labels', () => {
    const renderer = new ChartRenderer(canvas, candlestickSeries);
    renderer.render({ sorted: SAMPLE, times: TIMES, viewport: new Viewport(SAMPLE.length), hoverIndex: null, plugins: [] });
    const texts = ctx.fillText.mock.calls.map((call) => call[0] as string);
    // formatAxisLabel produces HH:mm / MM-DD / YYYY-MM shaped strings for this tiny time span
    expect(texts.some((t) => /^\d{2}:\d{2}$/.test(t) || /^\d{2}-\d{2}$/.test(t) || /^\d{4}-\d{2}$/.test(t))).toBe(
      true,
    );
  });
});
