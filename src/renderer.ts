import { formatAxisLabel, formatHoverTime, pickTickIndices } from './axis.js';
import { createScale } from './hybridScale.js';
import { formatPrice, niceTicks } from './priceAxis.js';
import type { ChartPlugin, PluginRenderApi } from './plugins/types.js';
import type { Scale } from './hybridScale.js';
import type { SeriesDefinition } from './series/types.js';
import type { CinderChartOptions, SeriesPoint } from './types.js';
import type { Viewport } from './viewport.js';

const DEFAULT_BACKGROUND = 'transparent';

const TIME_AXIS_HEIGHT = 24;
const PRICE_AXIS_WIDTH = 64;
const AXIS_MAX_TICKS = 6;
const PRICE_TICK_COUNT = 5;
const AXIS_TEXT_COLOR = '#787878';
const AXIS_LINE_COLOR = '#33333333';
const GRID_LINE_COLOR = '#2a2a2a55';
const CROSSHAIR_COLOR = '#9090904d';
const LEGEND_TEXT_COLOR = '#c8c8c8';
const CROSSHAIR_LABEL_BG = '#3a3a3a';
const CROSSHAIR_LABEL_TEXT = '#f0f0f0';
const LABEL_PADDING_X = 4;
const LABEL_PADDING_Y = 3;

export interface RenderInput<TPoint extends SeriesPoint> {
  /** Every point, sorted ascending by normalized time. */
  sorted: TPoint[];
  /** Parallel to `sorted` — each already run through `toUnixSeconds`. */
  times: number[];
  viewport: Viewport;
  /** Index into `sorted` (not viewport-local) of the hovered point, or null. */
  hoverIndex: number | null;
  plugins: ChartPlugin<TPoint>[];
}

/**
 * The chart engine's renderer: canvas lifecycle, axes, crosshair, and
 * plugin drawing are all generic — none of it knows what kind of series is
 * on screen. The one series-specific seam is `seriesDefinition`, injected
 * at construction (see `src/series/types.ts`); everything above delegates
 * to it for value-range computation, point drawing, and legend text.
 * Stateless per call otherwise — all pan/zoom/hover state lives in
 * `Viewport` and `CinderChart`; this class only turns a snapshot of that
 * state into pixels.
 */
export class ChartRenderer<TPoint extends SeriesPoint> {
  private ctx: CanvasRenderingContext2D;
  private background: string;
  private style: unknown;

  constructor(
    private canvas: HTMLCanvasElement,
    private seriesDefinition: SeriesDefinition<TPoint, unknown>,
    options: CinderChartOptions = {},
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('cinderchart: canvas 2d context unavailable');
    this.ctx = ctx;
    this.background = options.background ?? DEFAULT_BACKGROUND;
    this.style = { ...(seriesDefinition.defaultStyle as object), ...(options.style ?? {}) };
  }

  /** Pixel width of the point-plotting area — excludes the price-axis
   * strip on the right. Exposed so `CinderChart` can convert cursor pixel
   * positions to point indices / values for hit-testing and dragging. */
  get chartWidth(): number {
    return Math.max(0, this.canvas.width - PRICE_AXIS_WIDTH);
  }

  get chartHeight(): number {
    return Math.max(0, this.canvas.height - TIME_AXIS_HEIGHT);
  }

  get priceAxisWidth(): number {
    return PRICE_AXIS_WIDTH;
  }

  render(input: RenderInput<TPoint>): void {
    const { ctx, canvas, background, seriesDefinition, style } = this;
    const { sorted, times, viewport, hoverIndex, plugins } = input;
    const width = canvas.width;
    const height = canvas.height;
    const chartWidth = this.chartWidth;
    const chartHeight = this.chartHeight;

    ctx.clearRect(0, 0, width, height);
    if (background !== 'transparent') {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, width, height);
    }

    if (sorted.length === 0 || chartWidth <= 0 || chartHeight <= 0) return;

    const startIdx = Math.max(0, Math.floor(viewport.startIndex));
    const endIdx = Math.min(sorted.length, Math.ceil(viewport.endIndex));
    const visible = sorted.slice(startIdx, endIdx);
    if (visible.length === 0) return;

    // Manual mode (user has dragged/scaled the price axis) wins once set;
    // otherwise fit to whatever points are currently visible.
    const { min: valueMin, max: valueMax } =
      viewport.valueRangeOverride ?? seriesDefinition.getValueRange(visible, viewport.valueScaleFactor);

    // JS below a few hundred points, WASM above — see hybridScale.ts.
    // Whichever it picks, `dispose()` must run once we're done reading
    // from it (a no-op on the JS path, a real WASM memory free otherwise).
    const { scale: yScale, dispose: disposeYScale } = createScale(
      valueMin,
      valueMax,
      chartHeight,
      0,
      visible.length,
    );

    // Flipped in `finally`, right before `disposeYScale()` frees the WASM
    // scale's backing memory (a no-op on the JS path). Guards `yForValue`
    // below so a plugin that stashes it and calls it later gets a clear
    // thrown error instead of touching freed WASM memory — see the
    // interface-level warning on `PluginRenderApi`.
    let frameEnded = false;

    try {
      const slotWidth = chartWidth / viewport.visibleCount;

      // x position for a *global* sorted-array index — honors the (possibly
      // fractional) viewport.startIndex so panning is pixel-smooth, not
      // stepped a whole point at a time.
      const xForIndex = (globalIndex: number) => (globalIndex - viewport.startIndex) * slotWidth + slotWidth / 2;

      seriesDefinition.draw(
        { ctx, visible, startIndex: startIdx, xForIndex, slotWidth, yScale, chartHeight },
        style,
      );

      const priceStep = this.currentPriceStep(valueMin, valueMax);
      this.renderPriceAxis(valueMin, valueMax, priceStep, yScale, chartWidth, chartHeight);
      this.renderTimeAxis(times, startIdx, visible.length, chartHeight, chartWidth, xForIndex);

      if (hoverIndex !== null && hoverIndex >= startIdx && hoverIndex < endIdx) {
        this.renderCrosshairAndLegend(
          sorted[hoverIndex]!,
          xForIndex(hoverIndex),
          times[hoverIndex]!,
          yScale,
          priceStep,
          chartWidth,
          chartHeight,
        );
      }

      if (plugins.length > 0) {
        const api: PluginRenderApi<TPoint> = {
          ctx,
          chartWidth,
          chartHeight,
          xForIndex,
          yForValue: (value) => {
            if (frameEnded) {
              throw new Error(
                'cinderchart: PluginRenderApi.yForValue called after its frame ended — ' +
                  'only call it synchronously inside ChartPlugin.draw()',
              );
            }
            return yScale.map(value);
          },
          // Exact inverse of xForIndex above — solving
          // `x = (index - viewport.startIndex) * slotWidth + slotWidth / 2` for `index`.
          indexForX: (x) => viewport.startIndex + (x - slotWidth / 2) / slotWidth,
          // Exact inverse of the value->y mapping createScale set up for this
          // frame (domain [valueMin, valueMax] -> range [chartHeight, 0]).
          valueForY: (y) => valueMin + (1 - y / chartHeight) * (valueMax - valueMin),
          visibleStartIndex: startIdx,
          visibleEndIndex: endIdx,
          allPoints: sorted,
        };
        for (const plugin of plugins) {
          // save/restore isolates each plugin's canvas state (strokeStyle,
          // lineDash, ...) from the next one — a plugin that forgets to
          // clean up after itself can't bleed style into whatever draws
          // after it. try/catch isolates failures the same way: one
          // plugin throwing shouldn't blank out the rest of the chart.
          ctx.save();
          try {
            plugin.draw(api);
          } catch (error) {
            console.error('cinderchart: a plugin threw during draw()', error);
          } finally {
            ctx.restore();
          }
        }
      }
    } finally {
      frameEnded = true;
      disposeYScale();
    }
  }

  /** The decimal precision `formatPrice` should use for the current price
   * range — shared by the axis ticks and the crosshair's price label so
   * both display the same value with the same rounding. */
  private currentPriceStep(priceMin: number, priceMax: number): number {
    const ticks = niceTicks(priceMin, priceMax, PRICE_TICK_COUNT);
    return ticks.length > 1 ? ticks[1]! - ticks[0]! : 0;
  }

  private renderPriceAxis(
    priceMin: number,
    priceMax: number,
    step: number,
    yScale: Scale,
    chartWidth: number,
    chartHeight: number,
  ): void {
    const { ctx } = this;
    const ticks = niceTicks(priceMin, priceMax, PRICE_TICK_COUNT);

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

  private renderCrosshairAndLegend(
    point: TPoint,
    x: number,
    timeSeconds: number,
    yScale: Scale,
    priceStep: number,
    chartWidth: number,
    chartHeight: number,
  ): void {
    const { ctx, canvas, seriesDefinition, style } = this;

    ctx.save();
    ctx.strokeStyle = CROSSHAIR_COLOR;
    ctx.setLineDash([4, 4]);

    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, chartHeight);
    ctx.stroke();

    // Not every series has one natural "current value" (getPrimaryValue is
    // optional) — without one there's nothing to draw a horizontal line or
    // price label at, so only the vertical line + legend apply.
    const primaryValue = seriesDefinition.getPrimaryValue?.(point, style);
    const y = primaryValue !== undefined ? yScale.map(primaryValue) : null;
    const priceLineVisible = y !== null && y >= 0 && y <= chartHeight;
    if (priceLineVisible) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(chartWidth, y);
      ctx.stroke();
    }
    ctx.restore();

    if (priceLineVisible && primaryValue !== undefined) {
      this.renderPriceLabelChip(formatPrice(primaryValue, priceStep), y, chartWidth);
    }
    this.renderTimeLabelChip(formatHoverTime(timeSeconds), x, chartHeight, canvas.width);

    const parts = seriesDefinition.formatLegend?.(point, style) ?? [];
    if (parts.length === 0) return;

    ctx.font = '11px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = LEGEND_TEXT_COLOR;
    ctx.fillText(parts.join('   '), 8, 8);
  }

  /** The highlighted price-axis label that follows the crosshair's
   * horizontal line — drawn over `renderPriceAxis`'s own tick labels so the
   * hovered value reads clearly even where it lands between two ticks. */
  private renderPriceLabelChip(text: string, y: number, chartWidth: number): void {
    const { ctx } = this;
    ctx.font = '10px sans-serif';
    const chipHeight = 10 + LABEL_PADDING_Y * 2;

    ctx.fillStyle = CROSSHAIR_LABEL_BG;
    ctx.fillRect(chartWidth, y - chipHeight / 2, this.priceAxisWidth, chipHeight);

    ctx.fillStyle = CROSSHAIR_LABEL_TEXT;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, chartWidth + LABEL_PADDING_X, y);
  }

  /** The highlighted time-axis label under the crosshair's vertical line.
   * Clamped so its background chip stays fully on-screen even when the
   * hovered point sits at the very first or last visible index. */
  private renderTimeLabelChip(text: string, x: number, chartHeight: number, canvasWidth: number): void {
    const { ctx } = this;
    ctx.font = '10px sans-serif';
    const chipWidth = ctx.measureText(text).width + LABEL_PADDING_X * 2;
    const chipHeight = 10 + LABEL_PADDING_Y * 2;
    const chipLeft = Math.min(Math.max(x - chipWidth / 2, 0), canvasWidth - chipWidth);

    ctx.fillStyle = CROSSHAIR_LABEL_BG;
    ctx.fillRect(chipLeft, chartHeight, chipWidth, chipHeight);

    ctx.fillStyle = CROSSHAIR_LABEL_TEXT;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(text, chipLeft + LABEL_PADDING_X, chartHeight + LABEL_PADDING_Y);
  }
}
