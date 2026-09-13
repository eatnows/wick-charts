import { formatAxisLabel, formatHoverTime, pickTickIndices } from './axis.js';
import { createScale } from './hybridScale.js';
import { formatPrice, niceTicks } from './priceAxis.js';
import type { ChartPlugin, PluginRenderApi } from './plugins/types.js';
import type { Scale } from './hybridScale.js';
import type { SeriesDefinition } from './series/types.js';
import type {
  ChartAxisOptions,
  ChartCrosshairOptions,
  ChartFontOptions,
  ChartLegendOptions,
  CinderChartOptions,
  SeriesPoint,
} from './types.js';
import type { Viewport } from './viewport.js';

const DEFAULT_BACKGROUND = 'transparent';

const DEFAULT_FONT: Required<ChartFontOptions> = {
  family: 'sans-serif',
  axisSize: 10,
  legendSize: 11,
};

const DEFAULT_AXIS: Required<ChartAxisOptions> = {
  priceWidth: 64,
  timeHeight: 24,
  priceTickCount: 5,
  timeMaxTicks: 6,
  textColor: '#787878',
  lineColor: '#33333333',
  gridLineColor: '#2a2a2a55',
};

const DEFAULT_CROSSHAIR: Required<ChartCrosshairOptions> = {
  lineColor: '#9090904d',
  labelBackground: '#3a3a3a',
  labelTextColor: '#f0f0f0',
  labelPaddingX: 4,
  labelPaddingY: 3,
};

const DEFAULT_LEGEND: Required<ChartLegendOptions> = {
  textColor: '#f0f0f0',
  background: '#3a3a3a',
  paddingX: 8,
  paddingY: 6,
  cursorGap: 12,
};

export interface RenderInput<TPoint extends SeriesPoint> {
  /** Every point, sorted ascending by normalized time. */
  sorted: TPoint[];
  /** Parallel to `sorted` — each already run through `toUnixSeconds`. */
  times: number[];
  viewport: Viewport;
  /** Index into `sorted` (not viewport-local) of the hovered point, or null. */
  hoverIndex: number | null;
  /** Device-pixel y of the pointer/finger that produced `hoverIndex`, or
   * null. Drives the crosshair's horizontal line directly — see
   * `renderCrosshairAndLegend` for why that has to be the raw cursor
   * position rather than any property of the hovered point itself. */
  hoverY: number | null;
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
 *
 * Every visual constant below (fonts, axis sizing/coloring, crosshair
 * coloring/padding, legend color) is resolved once at construction from
 * `CinderChartOptions.font`/`axis`/`crosshair`/`legend`, each merged field
 * by field over its own defaults — nothing here is a hardcoded module
 * constant a caller can't reach.
 */
export class ChartRenderer<TPoint extends SeriesPoint> {
  private ctx: CanvasRenderingContext2D;
  private background: string;
  private style: unknown;
  private font: Required<ChartFontOptions>;
  private axis: Required<ChartAxisOptions>;
  private crosshair: Required<ChartCrosshairOptions>;
  private legend: Required<ChartLegendOptions>;

  constructor(
    private canvas: HTMLCanvasElement,
    private seriesDefinition: SeriesDefinition<TPoint, unknown>,
    options: CinderChartOptions = {},
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('cinder-charts: canvas 2d context unavailable');
    this.ctx = ctx;
    this.background = options.background ?? DEFAULT_BACKGROUND;
    this.style = { ...(seriesDefinition.defaultStyle as object), ...(options.style ?? {}) };
    this.font = { ...DEFAULT_FONT, ...options.font };
    this.axis = { ...DEFAULT_AXIS, ...options.axis };
    this.crosshair = { ...DEFAULT_CROSSHAIR, ...options.crosshair };
    this.legend = { ...DEFAULT_LEGEND, ...options.legend };
  }

  /** Pixel width of the point-plotting area — excludes the price-axis
   * strip on the right. Exposed so `CinderChart` can convert cursor pixel
   * positions to point indices / values for hit-testing and dragging. */
  get chartWidth(): number {
    return Math.max(0, this.canvas.width - this.axis.priceWidth);
  }

  get chartHeight(): number {
    return Math.max(0, this.canvas.height - this.axis.timeHeight);
  }

  get priceAxisWidth(): number {
    return this.axis.priceWidth;
  }

  private axisFont(): string {
    return `${this.font.axisSize}px ${this.font.family}`;
  }

  private legendFont(): string {
    return `${this.font.legendSize}px ${this.font.family}`;
  }

  render(input: RenderInput<TPoint>): void {
    const { ctx, canvas, background, seriesDefinition, style } = this;
    const { sorted, times, viewport, hoverIndex, hoverY, plugins } = input;
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
          hoverY,
          valueMin,
          valueMax,
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
                'cinder-charts: PluginRenderApi.yForValue called after its frame ended — ' +
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
          if (plugin.visible === false) continue;
          // save/restore isolates each plugin's canvas state (strokeStyle,
          // lineDash, ...) from the next one — a plugin that forgets to
          // clean up after itself can't bleed style into whatever draws
          // after it. try/catch isolates failures the same way: one
          // plugin throwing shouldn't blank out the rest of the chart.
          ctx.save();
          try {
            plugin.draw(api);
          } catch (error) {
            console.error('cinder-charts: a plugin threw during draw()', error);
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
    const ticks = niceTicks(priceMin, priceMax, this.axis.priceTickCount);
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
    const { ctx, axis } = this;
    const ticks = niceTicks(priceMin, priceMax, axis.priceTickCount);

    ctx.strokeStyle = axis.lineColor;
    ctx.beginPath();
    ctx.moveTo(chartWidth + 0.5, 0);
    ctx.lineTo(chartWidth + 0.5, chartHeight);
    ctx.stroke();

    ctx.font = this.axisFont();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    for (const value of ticks) {
      const y = yScale.map(value);
      if (y < 0 || y > chartHeight) continue;

      ctx.strokeStyle = axis.gridLineColor;
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(chartWidth, y + 0.5);
      ctx.stroke();

      ctx.fillStyle = axis.textColor;
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
    const { ctx, axis } = this;
    const visibleTimes = times.slice(startIdx, startIdx + visibleCount);
    const spanSeconds = visibleTimes[visibleTimes.length - 1]! - visibleTimes[0]!;

    ctx.strokeStyle = axis.lineColor;
    ctx.beginPath();
    ctx.moveTo(0, chartHeight + 0.5);
    ctx.lineTo(chartWidth, chartHeight + 0.5);
    ctx.stroke();

    ctx.fillStyle = axis.textColor;
    ctx.font = this.axisFont();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    for (const localIndex of pickTickIndices(visibleCount, axis.timeMaxTicks)) {
      const x = xForIndex(startIdx + localIndex);
      const label = formatAxisLabel(visibleTimes[localIndex]!, spanSeconds);
      ctx.fillText(label, x, chartHeight + 6);
    }
  }

  private renderCrosshairAndLegend(
    point: TPoint,
    x: number,
    timeSeconds: number,
    hoverY: number | null,
    valueMin: number,
    valueMax: number,
    priceStep: number,
    chartWidth: number,
    chartHeight: number,
  ): void {
    const { ctx, canvas, seriesDefinition, style, crosshair } = this;

    ctx.save();
    ctx.strokeStyle = crosshair.lineColor;
    ctx.setLineDash([4, 4]);

    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, chartHeight);
    ctx.stroke();

    // The horizontal line follows the actual cursor/finger position, not
    // any property of the hovered point — pinning it to (say) the candle's
    // close would leave it motionless while the pointer moves anywhere
    // within that same candle's column, which reads as broken/stuck rather
    // than as a crosshair. Only drawn while the pointer is actually inside
    // the chart's vertical extent, same as the price-axis tick-skip logic
    // in renderPriceAxis.
    const priceLineVisible = hoverY !== null && hoverY >= 0 && hoverY <= chartHeight;
    if (priceLineVisible) {
      ctx.beginPath();
      ctx.moveTo(0, hoverY);
      ctx.lineTo(chartWidth, hoverY);
      ctx.stroke();
    }
    ctx.restore();

    if (priceLineVisible) {
      // Exact inverse of the value->y mapping createScale set up for this
      // frame — same formula as PluginRenderApi.valueForY.
      const value = valueMin + (1 - hoverY / chartHeight) * (valueMax - valueMin);
      this.renderPriceLabelChip(formatPrice(value, priceStep), hoverY, chartWidth);
    }
    this.renderTimeLabelChip(formatHoverTime(timeSeconds), x, chartHeight, canvas.width);

    const parts = seriesDefinition.formatLegend?.(point, style) ?? [];
    if (parts.length === 0) return;
    this.renderHoverTooltip(parts, x, hoverY, chartWidth, chartHeight);
  }

  /** The OHLC(+volume) tooltip — floats near the hovered pixel like a
   * speech bubble, one line per part, rather than a fixed banner glued to
   * a corner of the canvas. Offset up-and-right of the cursor/finger by
   * `legend.cursorGap` and clamped to both chart edges so it never runs
   * off-screen, including when there's no `hoverY` to anchor to (a series
   * with no primary value still gets a legend, just pinned near the top
   * at the hovered column). */
  private renderHoverTooltip(
    lines: string[],
    x: number,
    hoverY: number | null,
    chartWidth: number,
    chartHeight: number,
  ): void {
    const { ctx, font, legend } = this;
    ctx.font = this.legendFont();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    const lineHeight = font.legendSize + 4;
    const textWidth = Math.max(...lines.map((line) => ctx.measureText(line).width));
    const boxWidth = textWidth + legend.paddingX * 2;
    const boxHeight = lines.length * lineHeight + legend.paddingY * 2;

    const anchorY = hoverY ?? 0;
    const left = Math.min(Math.max(x + legend.cursorGap, 0), Math.max(0, chartWidth - boxWidth));
    const top = Math.min(
      Math.max(anchorY - boxHeight - legend.cursorGap, 0),
      Math.max(0, chartHeight - boxHeight),
    );

    ctx.fillStyle = legend.background;
    ctx.fillRect(left, top, boxWidth, boxHeight);

    ctx.fillStyle = legend.textColor;
    lines.forEach((line, i) => {
      ctx.fillText(line, left + legend.paddingX, top + legend.paddingY + i * lineHeight);
    });
  }

  /** The highlighted price-axis label that follows the crosshair's
   * horizontal line — drawn over `renderPriceAxis`'s own tick labels so the
   * hovered value reads clearly even where it lands between two ticks. */
  private renderPriceLabelChip(text: string, y: number, chartWidth: number): void {
    const { ctx, font, crosshair } = this;
    ctx.font = this.axisFont();
    const chipHeight = font.axisSize + crosshair.labelPaddingY * 2;

    ctx.fillStyle = crosshair.labelBackground;
    ctx.fillRect(chartWidth, y - chipHeight / 2, this.priceAxisWidth, chipHeight);

    ctx.fillStyle = crosshair.labelTextColor;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, chartWidth + crosshair.labelPaddingX, y);
  }

  /** The highlighted time-axis label under the crosshair's vertical line.
   * Clamped so its background chip stays fully on-screen even when the
   * hovered point sits at the very first or last visible index. */
  private renderTimeLabelChip(text: string, x: number, chartHeight: number, canvasWidth: number): void {
    const { ctx, font, crosshair } = this;
    ctx.font = this.axisFont();
    const chipWidth = ctx.measureText(text).width + crosshair.labelPaddingX * 2;
    const chipHeight = font.axisSize + crosshair.labelPaddingY * 2;
    const chipLeft = Math.min(Math.max(x - chipWidth / 2, 0), canvasWidth - chipWidth);

    ctx.fillStyle = crosshair.labelBackground;
    ctx.fillRect(chipLeft, chartHeight, chipWidth, chipHeight);

    ctx.fillStyle = crosshair.labelTextColor;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(text, chipLeft + crosshair.labelPaddingX, chartHeight + crosshair.labelPaddingY);
  }
}
