// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { ChartRenderer } from './renderer';
import { candlestickSeries } from './series/candlestick';
import { createTestCanvas } from './testHelpers';
import { Viewport } from './viewport';
import type { Candle } from './types';
import type { SeriesDefinition } from './series/types';
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
    renderer.render({ sorted: [], times: [], viewport, hoverIndex: null, hoverY: null, plugins: [], panes: [] });

    expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, 800, 400);
    expect(ctx.fillRect).not.toHaveBeenCalled();
    expect(ctx.stroke).not.toHaveBeenCalled();
  });

  it('fills the background when a non-transparent color is configured', () => {
    const renderer = new ChartRenderer(canvas, candlestickSeries, { background: '#111111' });
    renderer.render({ sorted: [], times: [], viewport: new Viewport(0), hoverIndex: null, hoverY: null, plugins: [], panes: [] });
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 800, 400);
  });

  it('draws one wick (stroke) and one body (fillRect) per visible candle', () => {
    const renderer = new ChartRenderer(canvas, candlestickSeries);
    const viewport = new Viewport(SAMPLE.length);
    renderer.render({ sorted: SAMPLE, times: TIMES, viewport, hoverIndex: null, hoverY: null, plugins: [], panes: [] });

    expect(ctx.stroke.mock.calls.length).toBeGreaterThanOrEqual(SAMPLE.length);
    // one body fillRect per candle, plus zero or more axis fills (background is transparent here)
    const bodyFills = ctx.fillRect.mock.calls.length;
    expect(bodyFills).toBe(SAMPLE.length);
  });

  it('does not draw candles when the chart area has no usable width', () => {
    const { canvas: tiny, ctx: tinyCtx } = createTestCanvas(10, 400); // narrower than the 64px price axis
    const renderer = new ChartRenderer(tiny, candlestickSeries);
    renderer.render({ sorted: SAMPLE, times: TIMES, viewport: new Viewport(SAMPLE.length), hoverIndex: null, hoverY: null, plugins: [], panes: [] });
    expect(tinyCtx.fillRect).not.toHaveBeenCalled();
  });

  it('draws a crosshair and an OHLC legend only when hoverIndex is inside the visible range', () => {
    const renderer = new ChartRenderer(canvas, candlestickSeries);
    const viewport = new Viewport(SAMPLE.length);

    renderer.render({ sorted: SAMPLE, times: TIMES, viewport, hoverIndex: null, hoverY: null, plugins: [], panes: [] });
    const fillTextCallsWithoutHover = ctx.fillText.mock.calls.length;
    ctx.fillText.mockClear();

    renderer.render({ sorted: SAMPLE, times: TIMES, viewport, hoverIndex: 1, hoverY: 100, plugins: [], panes: [] });
    const fillTextCallsWithHover = ctx.fillText.mock.calls.length;

    // hovering adds exactly six more fillText calls versus the no-hover render:
    // the price-axis label, the time-axis label, and the OHLC tooltip's 4 lines
    expect(fillTextCallsWithHover).toBe(fillTextCallsWithoutHover + 6);

    const texts = ctx.fillText.mock.calls.map((call) => call[0] as string);
    expect(texts.some((t) => t.startsWith('O '))).toBe(true);
    expect(texts.some((t) => t.startsWith('C '))).toBe(true);
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
      panes: [],
    });
    const [legendText] = ctx.fillText.mock.calls[ctx.fillText.mock.calls.length - 1] as [string];
    expect(legendText).toContain('Vol');
  });

  it('renders price-axis tick labels', () => {
    const renderer = new ChartRenderer(canvas, candlestickSeries);
    renderer.render({ sorted: SAMPLE, times: TIMES, viewport: new Viewport(SAMPLE.length), hoverIndex: null, hoverY: null, plugins: [], panes: [] });
    // price ticks are formatted with toLocaleString-free comma grouping via formatPrice;
    // just assert at least one fillText call looks like a plain number label.
    const texts = ctx.fillText.mock.calls.map((call) => call[0] as string);
    expect(texts.some((t) => /^-?[\d,.]+$/.test(t))).toBe(true);
  });

  it('renders time-axis tick labels', () => {
    const renderer = new ChartRenderer(canvas, candlestickSeries);
    renderer.render({ sorted: SAMPLE, times: TIMES, viewport: new Viewport(SAMPLE.length), hoverIndex: null, hoverY: null, plugins: [], panes: [] });
    const texts = ctx.fillText.mock.calls.map((call) => call[0] as string);
    // formatAxisLabel produces HH:mm / MM-DD / YYYY-MM shaped strings for this tiny time span
    expect(texts.some((t) => /^\d{2}:\d{2}$/.test(t) || /^\d{2}-\d{2}$/.test(t) || /^\d{4}-\d{2}$/.test(t))).toBe(
      true,
    );
  });

  describe('crosshair axis labels', () => {
    it('draws a price-axis label chip at the hovered pixel row, and a time-axis label chip at the hovered time', () => {
      const renderer = new ChartRenderer(canvas, candlestickSeries);
      renderer.render({ sorted: SAMPLE, times: TIMES, viewport: new Viewport(SAMPLE.length), hoverIndex: 1, hoverY: 100, plugins: [], panes: [] });

      const texts = ctx.fillText.mock.calls.map((call) => call[0] as string);
      // formatHoverTime always renders a full "YYYY-MM-DD HH:mm" label
      expect(texts.some((t) => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(t))).toBe(true);

      // both label chips paint a background rect in addition to the candle bodies
      expect(ctx.fillRect.mock.calls.length).toBeGreaterThan(SAMPLE.length);
    });

    it('follows the hovered pixel row, not a fixed value like the candle close', () => {
      const renderer = new ChartRenderer(canvas, candlestickSeries);
      const viewport = new Viewport(SAMPLE.length);

      renderer.render({ sorted: SAMPLE, times: TIMES, viewport, hoverIndex: 1, hoverY: 20, plugins: [], panes: [] });
      // the price label chip's fillText is drawn at exactly (chartWidth + padding, hoverY)
      const priceLabelNearTop = ctx.fillText.mock.calls.find((call) => call[2] === 20)?.[0] as string | undefined;

      renderer.render({ sorted: SAMPLE, times: TIMES, viewport, hoverIndex: 1, hoverY: 300, plugins: [], panes: [] });
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
      renderer.render({ sorted: SAMPLE, times: TIMES, viewport: new Viewport(SAMPLE.length), hoverIndex: 1, hoverY: null, plugins: [], panes: [] });

      // with no price line, only the time label chip's and the legend
      // tooltip's background rects are added on top of the candle bodies
      // (one fillRect each) — no price label chip
      expect(ctx.fillRect.mock.calls.length).toBe(SAMPLE.length + 2);
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
        panes: [],
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
        panes: [],
      });

      expect(drawCalled).toBe(true);
    });
  });

  describe('customizable styling (font/axis/crosshair/legend options)', () => {
    it('resizes the price-axis strip and time-axis strip via axis.priceWidth/timeHeight', () => {
      const renderer = new ChartRenderer(canvas, candlestickSeries, { axis: { priceWidth: 100, timeHeight: 40 } });
      expect(renderer.chartWidth).toBe(800 - 100);
      expect(renderer.chartHeight).toBe(400 - 40);
      expect(renderer.priceAxisWidth).toBe(100);
    });

    it('uses a custom font family and axis font size for axis tick labels', () => {
      const renderer = new ChartRenderer(canvas, candlestickSeries, { font: { family: 'monospace', axisSize: 14 } });
      renderer.render({
        sorted: SAMPLE,
        times: TIMES,
        viewport: new Viewport(SAMPLE.length),
        hoverIndex: null,
        hoverY: null,
        plugins: [],
        panes: [],
      });
      // the axis font is the last one set on a no-hover render (see renderTimeAxis)
      expect(ctx.font).toBe('14px monospace');
    });

    it('uses a custom legend font size while hovering', () => {
      const renderer = new ChartRenderer(canvas, candlestickSeries, { font: { family: 'monospace', legendSize: 16 } });
      renderer.render({
        sorted: SAMPLE,
        times: TIMES,
        viewport: new Viewport(SAMPLE.length),
        hoverIndex: 1,
        hoverY: 100,
        plugins: [],
        panes: [],
      });
      // the legend font is the last one set once a hover legend draws
      expect(ctx.font).toBe('16px monospace');
    });

    it('uses custom axis line and text colors', () => {
      const renderer = new ChartRenderer(canvas, candlestickSeries, {
        axis: { lineColor: '#111111', textColor: '#222222' },
      });
      renderer.render({
        sorted: SAMPLE,
        times: TIMES,
        viewport: new Viewport(SAMPLE.length),
        hoverIndex: null,
        hoverY: null,
        plugins: [],
        panes: [],
      });
      // the time axis's boundary-line stroke and tick fillStyle are the last ones set
      expect(ctx.strokeStyle).toBe('#111111');
      expect(ctx.fillStyle).toBe('#222222');
    });

    it('uses a custom crosshair line color and label chip padding', () => {
      const renderer = new ChartRenderer(canvas, candlestickSeries, {
        crosshair: { lineColor: '#333333', labelPaddingX: 10 },
      });
      renderer.render({
        sorted: SAMPLE,
        times: TIMES,
        viewport: new Viewport(SAMPLE.length),
        hoverIndex: 1,
        hoverY: 100,
        plugins: [],
        panes: [],
      });

      expect(ctx.strokeStyle).toBe('#333333'); // last stroke color set is the crosshair's

      const priceLabelCall = ctx.fillText.mock.calls.find((call) => call[2] === 100) as
        | [string, number, number]
        | undefined;
      expect(priceLabelCall).toBeDefined();
      expect(priceLabelCall![1]).toBe(renderer.chartWidth + 10); // custom labelPaddingX
    });

    it('uses custom crosshair label chip background/text colors and vertical padding', () => {
      const renderer = new ChartRenderer(canvas, candlestickSeries, {
        crosshair: { labelBackground: '#444444', labelTextColor: '#555555', labelPaddingY: 10 },
      });
      renderer.render({
        sorted: SAMPLE,
        times: TIMES,
        viewport: new Viewport(SAMPLE.length),
        hoverIndex: 1,
        hoverY: 100,
        plugins: [],
        panes: [],
      });

      // the time-axis label chip's background rect (found by its y === chartHeight,
      // same convention used elsewhere) reflects the custom vertical padding
      // (axisSize 10 + labelPaddingY 10*2 = 30)
      const timeChipRect = ctx.fillRect.mock.calls.find(
        (call) => (call as [number, number, number, number])[1] === renderer.chartHeight,
      ) as [number, number, number, number] | undefined;
      expect(timeChipRect).toBeDefined();
      expect(timeChipRect![3]).toBe(30);
      const priceLabelText = ctx.fillText.mock.calls.find((call) => call[2] === 100)?.[0];
      expect(priceLabelText).toBeDefined();
    });

    it('uses a custom legend text color', () => {
      const renderer = new ChartRenderer(canvas, candlestickSeries, { legend: { textColor: '#666666' } });
      renderer.render({
        sorted: SAMPLE,
        times: TIMES,
        viewport: new Viewport(SAMPLE.length),
        hoverIndex: 1,
        hoverY: 100,
        plugins: [],
        panes: [],
      });
      expect(ctx.fillStyle).toBe('#666666'); // the legend's fillStyle is the last one set
    });

    it('positions the OHLC tooltip near the hovered pixel, not a fixed corner', () => {
      const renderer = new ChartRenderer(canvas, candlestickSeries);
      const viewport = new Viewport(SAMPLE.length);

      // the tooltip is drawn last in each render pass — nothing else paints a
      // fillRect after it (see renderCrosshairAndLegend's draw order), so the
      // last call recorded right after each render() is its tooltip box
      renderer.render({ sorted: SAMPLE, times: TIMES, viewport, hoverIndex: 1, hoverY: 100, plugins: [], panes: [] });
      const boxNearTop = ctx.fillRect.mock.calls[ctx.fillRect.mock.calls.length - 1] as [
        number,
        number,
        number,
        number,
      ];

      renderer.render({ sorted: SAMPLE, times: TIMES, viewport, hoverIndex: 1, hoverY: 300, plugins: [], panes: [] });
      const boxNearBottom = ctx.fillRect.mock.calls[ctx.fillRect.mock.calls.length - 1] as [
        number,
        number,
        number,
        number,
      ];

      // moving the hover row down moves the tooltip's top edge down too
      expect(boxNearBottom[1]).toBeGreaterThan(boxNearTop[1]);
    });

    it('clamps the tooltip so it never runs off the top or left chart edge', () => {
      const renderer = new ChartRenderer(canvas, candlestickSeries);
      // hoverIndex 0 at the very left edge, hoverY near the very top — both the
      // natural (x + gap, y - height - gap) position and a naive clamp could
      // still go negative without the chart-edge clamp
      renderer.render({
        sorted: SAMPLE,
        times: TIMES,
        viewport: new Viewport(SAMPLE.length),
        hoverIndex: 0,
        hoverY: 2,
        plugins: [],
        panes: [],
      });

      // the tooltip is drawn last in the render pass — nothing else paints a
      // fillRect after it (see renderCrosshairAndLegend's draw order)
      const tooltipBox = ctx.fillRect.mock.calls[ctx.fillRect.mock.calls.length - 1] as [
        number,
        number,
        number,
        number,
      ];
      expect(tooltipBox[0]).toBeGreaterThanOrEqual(0);
      expect(tooltipBox[1]).toBeGreaterThanOrEqual(0);
    });

    it('uses a custom legend background and padding', () => {
      const renderer = new ChartRenderer(canvas, candlestickSeries, {
        legend: { background: '#777777', paddingX: 20, paddingY: 20 },
      });
      renderer.render({
        sorted: SAMPLE,
        times: TIMES,
        viewport: new Viewport(SAMPLE.length),
        hoverIndex: 1,
        hoverY: 100,
        plugins: [],
        panes: [],
      });

      // the tooltip is drawn last in the render pass — nothing else paints a
      // fillRect after it (see renderCrosshairAndLegend's draw order)
      const tooltipBox = ctx.fillRect.mock.calls[ctx.fillRect.mock.calls.length - 1] as [
        number,
        number,
        number,
        number,
      ];
      // 4 lines (O/H/L/C) * (legendSize 11 + 4) + paddingY 20*2 = 100
      expect(tooltipBox[3]).toBe(100);
    });

    it('uses a custom cursorGap to offset the tooltip from the hovered pixel', () => {
      const defaultGap = new ChartRenderer(canvas, candlestickSeries);
      defaultGap.render({
        sorted: SAMPLE,
        times: TIMES,
        viewport: new Viewport(SAMPLE.length),
        hoverIndex: 1,
        hoverY: 100,
        plugins: [],
        panes: [],
      });
      const defaultBox = ctx.fillRect.mock.calls[ctx.fillRect.mock.calls.length - 1] as [
        number,
        number,
        number,
        number,
      ];

      const wideGap = new ChartRenderer(canvas, candlestickSeries, { legend: { cursorGap: 40 } });
      wideGap.render({
        sorted: SAMPLE,
        times: TIMES,
        viewport: new Viewport(SAMPLE.length),
        hoverIndex: 1,
        hoverY: 100,
        plugins: [],
        panes: [],
      });
      const wideGapBox = ctx.fillRect.mock.calls[ctx.fillRect.mock.calls.length - 1] as [
        number,
        number,
        number,
        number,
      ];

      // a larger cursorGap pushes the tooltip further right of the hovered pixel
      expect(wideGapBox[0]).toBeGreaterThan(defaultBox[0]);
    });

    it('draws fewer axis tick labels with a smaller priceTickCount/timeMaxTicks', () => {
      const manyCandles = Array.from({ length: 100 }, (_, i) => candle(i, 100 + i, 105 + i, 95 + i, 102 + i));
      const manyTimes = manyCandles.map((c) => c.time as number);

      const fewTicks = new ChartRenderer(canvas, candlestickSeries, {
        axis: { priceTickCount: 2, timeMaxTicks: 2 },
      });
      fewTicks.render({
        sorted: manyCandles,
        times: manyTimes,
        viewport: new Viewport(manyCandles.length),
        hoverIndex: null,
        hoverY: null,
        plugins: [],
        panes: [],
      });
      const fewCallCount = ctx.fillText.mock.calls.length;

      ctx.fillText.mockClear();
      const manyTicks = new ChartRenderer(canvas, candlestickSeries, {
        axis: { priceTickCount: 10, timeMaxTicks: 10 },
      });
      manyTicks.render({
        sorted: manyCandles,
        times: manyTimes,
        viewport: new Viewport(manyCandles.length),
        hoverIndex: null,
        hoverY: null,
        plugins: [],
        panes: [],
      });
      const manyCallCount = ctx.fillText.mock.calls.length;

      expect(manyCallCount).toBeGreaterThan(fewCallCount);
    });
  });

  describe('multi-pane support', () => {
    it('shrinks the main pane to make room for a declared pane, and offers plugins its actual height', () => {
      const renderer = new ChartRenderer(canvas, candlestickSeries);
      const fullChartHeight = renderer.chartHeight;
      let mainApiChartHeight: number | null = null;

      renderer.render({
        sorted: SAMPLE,
        times: TIMES,
        viewport: new Viewport(SAMPLE.length),
        hoverIndex: null,
        hoverY: null,
        plugins: [{ draw: (api) => (mainApiChartHeight = api.chartHeight) }],
        panes: [{ id: 'rsi', heightRatio: 0.25, getValueRange: () => ({ min: 0, max: 100 }) }],
      });

      // A quarter of the plotting height went to the declared pane, so the
      // main pane (and the api a main-targeted plugin receives) should
      // reflect the other three quarters, not the full chartHeight.
      expect(mainApiChartHeight).toBeCloseTo(fullChartHeight * 0.75, 5);
      expect(mainApiChartHeight).toBeLessThan(fullChartHeight);
    });

    it('routes a paneId-targeted plugin to its own pane, with pane-local coordinates', () => {
      const renderer = new ChartRenderer(canvas, candlestickSeries);
      const fullChartHeight = renderer.chartHeight;
      let paneApiChartHeight: number | null = null;
      let yForValue50: number | null = null;

      renderer.render({
        sorted: SAMPLE,
        times: TIMES,
        viewport: new Viewport(SAMPLE.length),
        hoverIndex: null,
        hoverY: null,
        plugins: [
          {
            paneId: 'rsi',
            draw: (api) => {
              paneApiChartHeight = api.chartHeight;
              yForValue50 = api.yForValue(50);
            },
          },
        ],
        panes: [{ id: 'rsi', heightRatio: 0.25, getValueRange: () => ({ min: 0, max: 100 }) }],
      });

      // The pane's own height (a quarter of the stack), not the main
      // pane's — and its pixel geometry sits below the main pane entirely.
      expect(paneApiChartHeight).toBeCloseTo(fullChartHeight * 0.25, 5);
      const mainPaneHeight = fullChartHeight * 0.75;
      expect(yForValue50).toBeGreaterThanOrEqual(mainPaneHeight);
      expect(yForValue50).toBeLessThanOrEqual(fullChartHeight);
    });

    it('gives a pane-targeted plugin yForValue/valueForY that exactly invert each other', () => {
      const renderer = new ChartRenderer(canvas, candlestickSeries);
      let inverted: number | null = null;

      renderer.render({
        sorted: SAMPLE,
        times: TIMES,
        viewport: new Viewport(SAMPLE.length),
        hoverIndex: null,
        hoverY: null,
        plugins: [
          {
            paneId: 'rsi',
            draw: (api) => {
              const y = api.yForValue(72);
              inverted = api.valueForY(y);
            },
          },
        ],
        panes: [{ id: 'rsi', heightRatio: 0.25, getValueRange: () => ({ min: 0, max: 100 }) }],
      });

      expect(inverted).toBeCloseTo(72, 5);
    });

    it('falls back to the main pane for a paneId with no matching declared pane', () => {
      const renderer = new ChartRenderer(canvas, candlestickSeries);
      let sawMainChartHeight: number | null = null;

      renderer.render({
        sorted: SAMPLE,
        times: TIMES,
        viewport: new Viewport(SAMPLE.length),
        hoverIndex: null,
        hoverY: null,
        plugins: [{ paneId: 'nonexistent', draw: (api) => (sawMainChartHeight = api.chartHeight) }],
        panes: [],
      });

      expect(sawMainChartHeight).toBe(renderer.chartHeight);
    });

    it('draws a separator line for each declared pane', () => {
      const renderer = new ChartRenderer(canvas, candlestickSeries);
      ctx.moveTo.mockClear();

      renderer.render({
        sorted: SAMPLE,
        times: TIMES,
        viewport: new Viewport(SAMPLE.length),
        hoverIndex: null,
        hoverY: null,
        plugins: [],
        panes: [{ id: 'rsi', heightRatio: 0.25, getValueRange: () => ({ min: 0, max: 100 }) }],
      });

      const mainPaneHeight = renderer.chartHeight * 0.75;
      const separatorDrawn = ctx.moveTo.mock.calls.some(
        ([x, y]) => x === 0 && Math.abs((y as number) - (mainPaneHeight + 0.5)) < 1e-6,
      );
      expect(separatorDrawn).toBe(true);
    });

    it('renders exactly as before when no panes are declared (backward compatible)', () => {
      const renderer = new ChartRenderer(canvas, candlestickSeries);
      let mainApiChartHeight: number | null = null;

      renderer.render({
        sorted: SAMPLE,
        times: TIMES,
        viewport: new Viewport(SAMPLE.length),
        hoverIndex: null,
        hoverY: null,
        plugins: [{ draw: (api) => (mainApiChartHeight = api.chartHeight) }],
        panes: [],
      });

      expect(mainApiChartHeight).toBe(renderer.chartHeight);
    });
  });

  describe('series draw() canvas-state isolation', () => {
    it('wraps seriesDefinition.draw() in save/restore, closed before axis rendering starts', () => {
      // FakeContext2D's save/restore are plain spies with no real stack
      // behavior (jsdom has no 2D canvas to snapshot), so this can't
      // observe an actual property being reverted — only that render()
      // brackets the series's draw() with save() before and restore()
      // after, the same ordering guarantee a real CanvasRenderingContext2D
      // would use to undo whatever draw() touched (see the regression this
      // guards: lineSeries.draw() sets ctx.lineWidth and never resets it).
      const order: string[] = [];
      ctx.save.mockImplementation(() => order.push('save'));
      ctx.restore.mockImplementation(() => order.push('restore'));
      ctx.stroke.mockImplementation(() => order.push('stroke')); // axis boundary/grid lines call this

      const probeSeries: SeriesDefinition<Candle, unknown> = {
        type: 'test-probe',
        defaultStyle: {},
        getValueRange: () => ({ min: 0, max: 100 }),
        draw: () => order.push('series-draw'),
      };
      const renderer = new ChartRenderer(canvas, probeSeries);
      renderer.render({
        sorted: SAMPLE,
        times: TIMES,
        viewport: new Viewport(SAMPLE.length),
        hoverIndex: null,
        hoverY: null,
        plugins: [],
        panes: [],
      });

      const saveIdx = order.indexOf('save');
      const drawIdx = order.indexOf('series-draw');
      const restoreIdx = order.indexOf('restore');
      const firstAxisStrokeIdx = order.indexOf('stroke');

      expect(saveIdx).toBeGreaterThanOrEqual(0);
      expect(saveIdx).toBeLessThan(drawIdx);
      expect(drawIdx).toBeLessThan(restoreIdx);
      expect(restoreIdx).toBeLessThan(firstAxisStrokeIdx);
    });
  });

  describe('devicePixelRatio scaling', () => {
    // createTestCanvas's third/fourth args are the CSS (display) size — a
    // backing store 2x the CSS size simulates devicePixelRatio 2, the same
    // convention the README's canvas-resize recipe produces.
    function retinaCanvas() {
      return createTestCanvas(800, 400, 400, 200);
    }

    it('scales chartWidth/chartHeight/priceAxisWidth by the canvas backing-store ratio', () => {
      const { canvas: retina } = retinaCanvas();
      const renderer = new ChartRenderer(retina, candlestickSeries, { axis: { priceWidth: 64, timeHeight: 24 } });
      // Author-facing values are CSS pixels; on a 2x backing store the
      // strips must occupy twice as many backing-store pixels to look the
      // same size on screen, and chartWidth/chartHeight (backing-store
      // pixels) shrink by the same scaled amount.
      expect(renderer.priceAxisWidth).toBe(128);
      expect(renderer.chartWidth).toBe(800 - 128);
      expect(renderer.chartHeight).toBe(400 - 48);
    });

    it('scales font/crosshair/legend size options for drawing, without a live resize notification', () => {
      const { canvas: retina, ctx: retinaCtx } = retinaCanvas();
      const renderer = new ChartRenderer(retina, candlestickSeries, { font: { axisSize: 10 } });
      renderer.render({
        sorted: SAMPLE,
        times: TIMES,
        viewport: new Viewport(SAMPLE.length),
        hoverIndex: null,
        hoverY: null,
        plugins: [],
        panes: [],
      });
      // 10 CSS px authored, 2x backing store -> 20 device px.
      expect(retinaCtx.font).toBe('20px sans-serif');
    });

    it('passes devicePixelRatio through to seriesDefinition.draw() and PluginRenderApi', () => {
      const { canvas: retina } = retinaCanvas();
      let seenBySeries: number | undefined;
      let seenByPlugin: number | undefined;
      const probeSeries: SeriesDefinition<Candle, unknown> = {
        type: 'test-probe',
        defaultStyle: {},
        getValueRange: () => ({ min: 0, max: 100 }),
        draw: (context) => {
          seenBySeries = context.devicePixelRatio;
        },
      };
      const renderer = new ChartRenderer(retina, probeSeries);
      renderer.render({
        sorted: SAMPLE,
        times: TIMES,
        viewport: new Viewport(SAMPLE.length),
        hoverIndex: null,
        hoverY: null,
        plugins: [{ draw: (api) => (seenByPlugin = api.devicePixelRatio) }],
        panes: [],
      });

      expect(seenBySeries).toBe(2);
      expect(seenByPlugin).toBe(2);
    });

    it('does not change anything at devicePixelRatio 1 (the CSS size equals the backing store)', () => {
      const renderer = new ChartRenderer(canvas, candlestickSeries);
      expect(renderer.priceAxisWidth).toBe(64);
      expect(renderer.chartWidth).toBe(800 - 64);
      expect(renderer.chartHeight).toBe(400 - 24);
    });
  });

  describe('invertValueAxis', () => {
    it('mirrors a plugin\'s yForValue/valueForY top-to-bottom compared to the default orientation', () => {
      const normal = new ChartRenderer(canvas, candlestickSeries);
      const inverted = new ChartRenderer(canvas, candlestickSeries, { invertValueAxis: true });
      let normalY: number | null = null;
      let invertedY: number | null = null;

      const probe = (setY: (y: number) => void) => ({ draw: (api: { yForValue: (v: number) => number }) => setY(api.yForValue(105)) });

      normal.render({
        sorted: SAMPLE,
        times: TIMES,
        viewport: new Viewport(SAMPLE.length),
        hoverIndex: null,
        hoverY: null,
        plugins: [probe((y) => (normalY = y))],
        panes: [],
      });
      inverted.render({
        sorted: SAMPLE,
        times: TIMES,
        viewport: new Viewport(SAMPLE.length),
        hoverIndex: null,
        hoverY: null,
        plugins: [probe((y) => (invertedY = y))],
        panes: [],
      });

      // Same value, same value-range and chartHeight (identical chart
      // setup otherwise) — an inverted chart must place it at the
      // mirror-image pixel: normalY + invertedY === chartHeight.
      expect(normalY).not.toBeNull();
      expect(invertedY).not.toBeNull();
      expect(normalY! + invertedY!).toBeCloseTo(normal.chartHeight, 5);
    });

    it('setInvertValueAxis flips subsequent renders without reconstructing the chart', () => {
      const renderer = new ChartRenderer(canvas, candlestickSeries);
      let firstY: number | null = null;
      let secondY: number | null = null;
      const render = (setY: (y: number) => void) =>
        renderer.render({
          sorted: SAMPLE,
          times: TIMES,
          viewport: new Viewport(SAMPLE.length),
          hoverIndex: null,
          hoverY: null,
          plugins: [{ draw: (api) => setY(api.yForValue(105)) }],
          panes: [],
        });

      render((y) => (firstY = y));
      renderer.setInvertValueAxis(true);
      render((y) => (secondY = y));

      expect(firstY! + secondY!).toBeCloseTo(renderer.chartHeight, 5);
    });

    it('inverts the hover crosshair\'s price-label value the same way pixelToValue predicts', () => {
      // A fixed value range (rather than candlestick's auto-fit) makes the
      // expected label text computable by hand instead of duplicating the
      // renderer's own range-fitting logic in this test.
      const fixedRangeSeries: SeriesDefinition<Candle, unknown> = {
        type: 'test-fixed-range',
        defaultStyle: {},
        getValueRange: () => ({ min: 0, max: 200 }),
        draw: () => {},
      };
      const hoverY = 50;
      // chartHeight = 400 - 24 (default timeHeight) = 376.
      // pixelToValue(50, 0, 200, 376, false) ≈ 173.40 -> formatted "173"
      // pixelToValue(50, 0, 200, 376, true)  ≈  26.60 -> formatted "27"

      const normal = new ChartRenderer(canvas, fixedRangeSeries);
      ctx.fillText.mockClear();
      normal.render({
        sorted: SAMPLE,
        times: TIMES,
        viewport: new Viewport(SAMPLE.length),
        hoverIndex: 1,
        hoverY,
        plugins: [],
        panes: [],
      });
      const normalTexts = ctx.fillText.mock.calls.map((call) => call[0]);

      const inverted = new ChartRenderer(canvas, fixedRangeSeries, { invertValueAxis: true });
      ctx.fillText.mockClear();
      inverted.render({
        sorted: SAMPLE,
        times: TIMES,
        viewport: new Viewport(SAMPLE.length),
        hoverIndex: 1,
        hoverY,
        plugins: [],
        panes: [],
      });
      const invertedTexts = ctx.fillText.mock.calls.map((call) => call[0]);

      expect(normalTexts).toContain('173');
      expect(invertedTexts).toContain('27');
    });
  });
});
