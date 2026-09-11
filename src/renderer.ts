import { formatAxisLabel, pickTickIndices } from './axis.js';
import { createScale } from './hybridScale.js';
import { formatPrice, niceTicks } from './priceAxis.js';
import { autoFitPriceRange } from './priceRange.js';
import type { Scale } from './hybridScale.js';
import type { Candle, CinderChartOptions } from './types.js';
import type { Viewport } from './viewport.js';

const DEFAULTS: Required<CinderChartOptions> = {
  background: 'transparent',
  upColor: '#26a69a',
  downColor: '#ef5350',
};

const TIME_AXIS_HEIGHT = 24;
const PRICE_AXIS_WIDTH = 64;
const AXIS_MAX_TICKS = 6;
const PRICE_TICK_COUNT = 5;
const AXIS_TEXT_COLOR = '#787878';
const AXIS_LINE_COLOR = '#33333333';
const GRID_LINE_COLOR = '#2a2a2a55';
const CROSSHAIR_COLOR = '#9090904d';
const LEGEND_TEXT_COLOR = '#c8c8c8';

export interface RenderInput {
  /** Every candle, sorted ascending by normalized time. */
  sorted: Candle[];
  /** Parallel to `sorted` — each already run through `toUnixSeconds`. */
  times: number[];
  viewport: Viewport;
  /** Index into `sorted` (not viewport-local) of the hovered candle, or null. */
  hoverIndex: number | null;
}

/** Candle + price-axis + time-axis renderer. Stateless per call — all
 * pan/zoom/hover state lives in `Viewport` and `CinderChart`; this class
 * only knows how to turn a snapshot of that state into pixels. */
export class CandleRenderer {
  private ctx: CanvasRenderingContext2D;
  private options: Required<CinderChartOptions>;

  constructor(
    private canvas: HTMLCanvasElement,
    options: CinderChartOptions = {},
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('cinderchart: canvas 2d context unavailable');
    this.ctx = ctx;
    this.options = { ...DEFAULTS, ...options };
  }

  /** Pixel width of the candle-plotting area — excludes the price-axis
   * strip on the right. Exposed so `CinderChart` can convert cursor pixel
   * positions to candle indices / prices for hit-testing and dragging. */
  get chartWidth(): number {
    return Math.max(0, this.canvas.width - PRICE_AXIS_WIDTH);
  }

  get chartHeight(): number {
    return Math.max(0, this.canvas.height - TIME_AXIS_HEIGHT);
  }

  get priceAxisWidth(): number {
    return PRICE_AXIS_WIDTH;
  }

  render(input: RenderInput): void {
    const { ctx, canvas, options } = this;
    const { sorted, times, viewport, hoverIndex } = input;
    const width = canvas.width;
    const height = canvas.height;
    const chartWidth = this.chartWidth;
    const chartHeight = this.chartHeight;

    ctx.clearRect(0, 0, width, height);
    if (options.background !== 'transparent') {
      ctx.fillStyle = options.background;
      ctx.fillRect(0, 0, width, height);
    }

    if (sorted.length === 0 || chartWidth <= 0 || chartHeight <= 0) return;

    const startIdx = Math.max(0, Math.floor(viewport.startIndex));
    const endIdx = Math.min(sorted.length, Math.ceil(viewport.endIndex));
    const visible = sorted.slice(startIdx, endIdx);
    if (visible.length === 0) return;

    // Manual mode (user has dragged/scaled the price axis) wins once set;
    // otherwise fit to whatever candles are currently visible.
    const { min: priceMin, max: priceMax } =
      viewport.priceRangeOverride ?? autoFitPriceRange(visible, viewport.priceScaleFactor);

    // JS below a few hundred points, WASM above — see hybridScale.ts.
    // Whichever it picks, `dispose()` must run once we're done reading
    // from it (a no-op on the JS path, a real WASM memory free otherwise).
    const { scale: yScale, dispose: disposeYScale } = createScale(
      priceMin,
      priceMax,
      chartHeight,
      0,
      visible.length,
    );

    try {
      const slotWidth = chartWidth / viewport.visibleCount;
      const bodyWidth = Math.max(1, slotWidth * 0.6);

      // x position for a *global* sorted-array index — honors the (possibly
      // fractional) viewport.startIndex so panning is pixel-smooth, not
      // stepped a whole candle at a time.
      const xForIndex = (globalIndex: number) => (globalIndex - viewport.startIndex) * slotWidth + slotWidth / 2;

      // Batched through mapMany (one call per array) rather than four
      // map() calls per candle in the loop below — the batch is what lets
      // the WASM path pay the JS↔WASM boundary cost once per frame instead
      // of once per point.
      const yHighs = yScale.mapMany(visible.map((c) => c.high));
      const yLows = yScale.mapMany(visible.map((c) => c.low));
      const yOpens = yScale.mapMany(visible.map((c) => c.open));
      const yCloses = yScale.mapMany(visible.map((c) => c.close));

      visible.forEach((candle, i) => {
        const x = xForIndex(startIdx + i);
        const isUp = candle.close >= candle.open;
        ctx.strokeStyle = ctx.fillStyle = isUp ? options.upColor : options.downColor;

        ctx.beginPath();
        ctx.moveTo(x, yHighs[i]!);
        ctx.lineTo(x, yLows[i]!);
        ctx.stroke();

        const yOpen = yOpens[i]!;
        const yClose = yCloses[i]!;
        const top = Math.min(yOpen, yClose);
        const bodyHeight = Math.max(1, Math.abs(yClose - yOpen));
        ctx.fillRect(x - bodyWidth / 2, top, bodyWidth, bodyHeight);
      });

      this.renderPriceAxis(priceMin, priceMax, yScale, chartWidth, chartHeight);
      this.renderTimeAxis(times, startIdx, visible.length, chartHeight, chartWidth, xForIndex);

      if (hoverIndex !== null && hoverIndex >= startIdx && hoverIndex < endIdx) {
        this.renderCrosshairAndLegend(sorted[hoverIndex]!, xForIndex(hoverIndex), chartHeight);
      }
    } finally {
      disposeYScale();
    }
  }

  private renderPriceAxis(
    priceMin: number,
    priceMax: number,
    yScale: Scale,
    chartWidth: number,
    chartHeight: number,
  ): void {
    const { ctx } = this;
    const ticks = niceTicks(priceMin, priceMax, PRICE_TICK_COUNT);
    const step = ticks.length > 1 ? ticks[1]! - ticks[0]! : 0;

    ctx.strokeStyle = AXIS_LINE_COLOR;
    ctx.beginPath();
    ctx.moveTo(chartWidth + 0.5, 0);
    ctx.lineTo(chartWidth + 0.5, chartHeight);
    ctx.stroke();

    ctx.font = '10px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    for (const value of ticks) {
      const y = yScale.map(value);
      if (y < 0 || y > chartHeight) continue;

      ctx.strokeStyle = GRID_LINE_COLOR;
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(chartWidth, y + 0.5);
      ctx.stroke();

      ctx.fillStyle = AXIS_TEXT_COLOR;
      ctx.fillText(formatPrice(value, step), chartWidth + 6, y);
    }
  }

  private renderTimeAxis(
    times: number[],
    startIdx: number,
    visibleCount: number,
    chartHeight: number,
    chartWidth: number,
    xForIndex: (globalIndex: number) => number,
  ): void {
    const { ctx } = this;
    const visibleTimes = times.slice(startIdx, startIdx + visibleCount);
    const spanSeconds = visibleTimes[visibleTimes.length - 1]! - visibleTimes[0]!;

    ctx.strokeStyle = AXIS_LINE_COLOR;
    ctx.beginPath();
    ctx.moveTo(0, chartHeight + 0.5);
    ctx.lineTo(chartWidth, chartHeight + 0.5);
    ctx.stroke();

    ctx.fillStyle = AXIS_TEXT_COLOR;
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    for (const localIndex of pickTickIndices(visibleCount, AXIS_MAX_TICKS)) {
      const x = xForIndex(startIdx + localIndex);
      const label = formatAxisLabel(visibleTimes[localIndex]!, spanSeconds);
      ctx.fillText(label, x, chartHeight + 6);
    }
  }

  private renderCrosshairAndLegend(candle: Candle, x: number, chartHeight: number): void {
    const { ctx } = this;

    ctx.save();
    ctx.strokeStyle = CROSSHAIR_COLOR;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, chartHeight);
    ctx.stroke();
    ctx.restore();

    const parts = [
      `O ${candle.open.toLocaleString('en-US')}`,
      `H ${candle.high.toLocaleString('en-US')}`,
      `L ${candle.low.toLocaleString('en-US')}`,
      `C ${candle.close.toLocaleString('en-US')}`,
    ];
    if (candle.volume !== undefined) {
      parts.push(`Vol ${candle.volume.toLocaleString('en-US')}`);
    }

    ctx.font = '11px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = LEGEND_TEXT_COLOR;
    ctx.fillText(parts.join('   '), 8, 8);
  }
}
