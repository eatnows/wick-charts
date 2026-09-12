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
    renderer.render({ sorted: [], times: [], viewport, hoverIndex: null, hoverY: null, plugins: [] });

    expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, 800, 400);
    expect(ctx.fillRect).not.toHaveBeenCalled();
    expect(ctx.stroke).not.toHaveBeenCalled();
  });

  it('fills the background when a non-transparent color is configured', () => {
    const renderer = new ChartRenderer(canvas, candlestickSeries, { background: '#111111' });
    renderer.render({ sorted: [], times: [], viewport: new Viewport(0), hoverIndex: null, hoverY: null, plugins: [] });
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 800, 400);
  });

  it('draws one wick (stroke) and one body (fillRect) per visible candle', () => {
    const renderer = new ChartRenderer(canvas, candlestickSeries);
    const viewport = new Viewport(SAMPLE.length);
    renderer.render({ sorted: SAMPLE, times: TIMES, viewport, hoverIndex: null, hoverY: null, plugins: [] });

    expect(ctx.stroke.mock.calls.length).toBeGreaterThanOrEqual(SAMPLE.length);
    // one body fillRect per candle, plus zero or more axis fills (background is transparent here)
    const bodyFills = ctx.fillRect.mock.calls.length;
    expect(bodyFills).toBe(SAMPLE.length);
  });

  it('does not draw candles when the chart area has no usable width', () => {
    const { canvas: tiny, ctx: tinyCtx } = createTestCanvas(10, 400); // narrower than the 64px price axis
    const renderer = new ChartRenderer(tiny, candlestickSeries);
    renderer.render({ sorted: SAMPLE, times: TIMES, viewport: new Viewport(SAMPLE.length), hoverIndex: null, hoverY: null, plugins: [] });
    expect(tinyCtx.fillRect).not.toHaveBeenCalled();
  });

  it('draws a crosshair and an OHLC legend only when hoverIndex is inside the visible range', () => {
    const renderer = new ChartRenderer(canvas, candlestickSeries);
    const viewport = new Viewport(SAMPLE.length);

    renderer.render({ sorted: SAMPLE, times: TIMES, viewport, hoverIndex: null, hoverY: null, plugins: [] });
    const fillTextCallsWithoutHover = ctx.fillText.mock.calls.length;
    ctx.fillText.mockClear();

    renderer.render({ sorted: SAMPLE, times: TIMES, viewport, hoverIndex: 1, hoverY: 100, plugins: [] });
    const fillTextCallsWithHover = ctx.fillText.mock.calls.length;

    // hovering adds exactly three more fillText calls versus the no-hover render:
    // the price-axis label, the time-axis label, and the OHLC legend line
    expect(fillTextCallsWithHover).toBe(fillTextCallsWithoutHover + 3);

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
      hoverY: 50,
      plugins: [],
    });
    const [legendText] = ctx.fillText.mock.calls[ctx.fillText.mock.calls.length - 1] as [string];
    expect(legendText).toContain('Vol');
  });

  it('renders price-axis tick labels', () => {
    const renderer = new ChartRenderer(canvas, candlestickSeries);
    renderer.render({ sorted: SAMPLE, times: TIMES, viewport: new Viewport(SAMPLE.length), hoverIndex: null, hoverY: null, plugins: [] });
    // price ticks are formatted with toLocaleString-free comma grouping via formatPrice;
    // just assert at least one fillText call looks like a plain number label.
    const texts = ctx.fillText.mock.calls.map((call) => call[0] as string);
    expect(texts.some((t) => /^-?[\d,.]+$/.test(t))).toBe(true);
  });

  it('renders time-axis tick labels', () => {
    const renderer = new ChartRenderer(canvas, candlestickSeries);
    renderer.render({ sorted: SAMPLE, times: TIMES, viewport: new Viewport(SAMPLE.length), hoverIndex: null, hoverY: null, plugins: [] });
    const texts = ctx.fillText.mock.calls.map((call) => call[0] as string);
    // formatAxisLabel produces HH:mm / MM-DD / YYYY-MM shaped strings for this tiny time span
    expect(texts.some((t) => /^\d{2}:\d{2}$/.test(t) || /^\d{2}-\d{2}$/.test(t) || /^\d{4}-\d{2}$/.test(t))).toBe(
      true,
    );
  });

  describe('crosshair axis labels', () => {
    it('draws a price-axis label chip at the hovered pixel row, and a time-axis label chip at the hovered time', () => {
      const renderer = new ChartRenderer(canvas, candlestickSeries);
      renderer.render({ sorted: SAMPLE, times: TIMES, viewport: new Viewport(SAMPLE.length), hoverIndex: 1, hoverY: 100, plugins: [] });

      const texts = ctx.fillText.mock.calls.map((call) => call[0] as string);
      // formatHoverTime always renders a full "YYYY-MM-DD HH:mm" label
      expect(texts.some((t) => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(t))).toBe(true);

      // both label chips paint a background rect in addition to the candle bodies
      expect(ctx.fillRect.mock.calls.length).toBeGreaterThan(SAMPLE.length);
    });

    it('follows the hovered pixel row, not a fixed value like the candle close', () => {
      const renderer = new ChartRenderer(canvas, candlestickSeries);
      const viewport = new Viewport(SAMPLE.length);

      renderer.render({ sorted: SAMPLE, times: TIMES, viewport, hoverIndex: 1, hoverY: 20, plugins: [] });
      // the price label chip's fillText is drawn at exactly (chartWidth + padding, hoverY)
      const priceLabelNearTop = ctx.fillText.mock.calls.find((call) => call[2] === 20)?.[0] as string | undefined;

      renderer.render({ sorted: SAMPLE, times: TIMES, viewport, hoverIndex: 1, hoverY: 300, plugins: [] });
      const priceLabelNearBottom = ctx.fillText.mock.calls.find((call) => call[2] === 300)?.[0] as
        | string
        | undefined;

      // same hovered candle, different pointer row -> a different price-axis label,
      // proving the horizontal line/label track the pointer and not the candle itself
      expect(priceLabelNearTop).toBeDefined();
      expect(priceLabelNearBottom).toBeDefined();
      expect(priceLabelNearTop).not.toBe(priceLabelNearBottom);
    });

    it('omits the horizontal line and price label when there is no hovered pixel row', () => {
      const renderer = new ChartRenderer(canvas, candlestickSeries);
      renderer.render({ sorted: SAMPLE, times: TIMES, viewport: new Viewport(SAMPLE.length), hoverIndex: 1, hoverY: null, plugins: [] });

      // with no price line, only the time label chip's background rect is added
      // on top of the candle bodies (one fillRect each)
      expect(ctx.fillRect.mock.calls.length).toBe(SAMPLE.length + 1);
      // the legend (which doesn't depend on hoverY at all) still draws
      const texts = ctx.fillText.mock.calls.map((call) => call[0] as string);
      expect(texts.some((t) => t.includes('O '))).toBe(true);
    });

    it('keeps the time-axis label chip fully on-screen even when hovering the first visible candle', () => {
      const manyCandles = Array.from({ length: 20 }, (_, i) => candle(i, 100 + i, 105 + i, 95 + i, 102 + i));
      const renderer = new ChartRenderer(canvas, candlestickSeries);
      renderer.render({
        sorted: manyCandles,
        times: manyCandles.map((c) => c.time as number),
        viewport: new Viewport(manyCandles.length),
        hoverIndex: 0, // near the left edge, where the chip would otherwise overflow past x=0
        hoverY: 100,
        plugins: [],
      });

      // the time-axis chip is the fillRect call in the bottom (time-axis) strip
      const chartHeight = renderer.chartHeight;
      const timeChipCall = ctx.fillRect.mock.calls.find(
        (call) => (call as [number, number, number, number])[1] === chartHeight,
      ) as [number, number, number, number] | undefined;
      expect(timeChipCall).toBeDefined();
      expect(timeChipCall![0]).toBeGreaterThanOrEqual(0); // left edge clamped, never negative
    });
  });

  describe('plugin geometry: inverse coordinate mapping', () => {
    it('gives plugins indexForX/valueForY that exactly invert xForIndex/yForValue', () => {
      const renderer = new ChartRenderer(canvas, candlestickSeries);
      let drawCalled = false;

      renderer.render({
        sorted: SAMPLE,
        times: TIMES,
        viewport: new Viewport(SAMPLE.length),
        hoverIndex: null,
        hoverY: null,
        plugins: [
          {
            draw: (api) => {
              drawCalled = true;
              const x = api.xForIndex(1);
              expect(api.indexForX(x)).toBeCloseTo(1, 10);

              const y = api.yForValue(105);
              expect(api.valueForY(y)).toBeCloseTo(105, 10);
            },
          },
        ],
      });

      expect(drawCalled).toBe(true);
    });
  });
});
