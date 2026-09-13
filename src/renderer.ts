import { formatAxisLabel, formatHoverTime, pickTickIndices } from './axis.js';
import { createScale } from './hybridScale.js';
import { computePaneLayout } from './paneLayout.js';
import { formatPrice, niceTicks } from './priceAxis.js';
import type { ChartPlugin, PluginRenderApi } from './plugins/types.js';
import type { Scale } from './hybridScale.js';
import type { PaneRect } from './paneLayout.js';
import type { SeriesDefinition } from './series/types.js';
import type {
  ChartAxisOptions,
  ChartCrosshairOptions,
  ChartFontOptions,
  ChartLegendOptions,
  ResolvedPaneOptions,
  WickChartOptions,
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
  /** Indicator/oscillator panes declared via `WickChart.addPane`, resolved
   * (defaults applied) — see `ResolvedPaneOptions`. Empty by default, in
   * which case the main pane alone fills the whole plotting height exactly
   * as it did before panes existed. */
  panes: ResolvedPaneOptions[];
}

/**
 * Everything a per-pane `PluginRenderApi` needs *besides* that one pane's
 * own rect/value-domain/scale — the parts every pane shares for a given
 * frame, since there is only one time axis (and one frame-ended flag) for
 * the whole stack. Bundled so `buildPluginApi` takes one argument for all
 * of this instead of six repeated at each of its call sites (one per pane).
 */
interface FrameGeometry<TPoint extends SeriesPoint> {
  chartWidth: number;
  xForIndex: (globalIndex: number) => number;
  indexForX: (x: number) => number;
  visibleStartIndex: number;
  visibleEndIndex: number;
  allPoints: readonly TPoint[];
  /** Flipped in `render()`'s `finally`, after which every pane's
   * `yForValue` throws instead of touching a freed WASM scale — see the
   * interface-level warning on `PluginRenderApi`. */
  frameState: { ended: boolean };
}

/**
 * The chart engine's renderer: canvas lifecycle, axes, crosshair, and
 * plugin drawing are all generic — none of it knows what kind of series is
 * on screen. The one series-specific seam is `seriesDefinition`, injected
 * at construction (see `src/series/types.ts`); everything above delegates
 * to it for value-range computation, point drawing, and legend text.
 * Stateless per call otherwise — all pan/zoom/hover state lives in
 * `Viewport` and `WickChart`; this class only turns a snapshot of that
 * state into pixels.
 *
 * Every visual constant below (fonts, axis sizing/coloring, crosshair
 * coloring/padding, legend color) is resolved once at construction from
 * `WickChartOptions.font`/`axis`/`crosshair`/`legend`, each merged field
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
    options: WickChartOptions = {},
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('wick-charts: canvas 2d context unavailable');
    this.ctx = ctx;
    this.background = options.background ?? DEFAULT_BACKGROUND;
    this.style = { ...(seriesDefinition.defaultStyle as object), ...(options.style ?? {}) };
    this.font = { ...DEFAULT_FONT, ...options.font };
    this.axis = { ...DEFAULT_AXIS, ...options.axis };
    this.crosshair = { ...DEFAULT_CROSSHAIR, ...options.crosshair };
    this.legend = { ...DEFAULT_LEGEND, ...options.legend };
  }

  /** Pixel width of the point-plotting area — excludes the price-axis
   * strip on the right. Exposed so `WickChart` can convert cursor pixel
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
    const { sorted, times, viewport, hoverIndex, hoverY, plugins, panes } = input;
    const width = canvas.width;
    const height = canvas.height;
    const chartWidth = this.chartWidth;
    // Full stack height: the main price pane plus every declared indicator
    // pane below it. `this.chartHeight` predates panes and named what's
    // now only true with zero of them — kept as the property name (public
    // API reads it through) but renamed locally here since most of this
    // method cares about one pane's height, not the stack's.
    const stackHeight = this.chartHeight;

    ctx.clearRect(0, 0, width, height);
    if (background !== 'transparent') {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, width, height);
    }

    if (sorted.length === 0 || chartWidth <= 0 || stackHeight <= 0) return;

    const { main: mainRect, panes: paneRects } = computePaneLayout(panes, stackHeight);
    const chartHeight = mainRect.height;

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

    // Every indicator pane gets the exact same treatment as the main pane
    // — its own value domain (from `PaneOptions.getValueRange`) and its
    // own JS/WASM scale over its own pixel height — kept alive for the
    // whole frame alongside `yScale`, since plugins targeting a pane draw
    // only after every pane's axis has already been rendered.
    const paneScales = paneRects.map((rect, i) => {
      const pane = panes[i]!;
      const { min, max } = pane.getValueRange();
      const { scale, dispose } = createScale(min, max, rect.height, 0, visible.length);
      return { pane, rect, min, max, scale, dispose };
    });

    // Flipped in `finally`, right before every scale above frees its WASM
    // backing memory (a no-op on the JS path). Guards `yForValue` below so
    // a plugin that stashes it and calls it later gets a clear thrown
    // error instead of touching freed memory — see the interface-level
    // warning on `PluginRenderApi`. An object (not a plain `let`) so every
    // pane's plugin-api closure, built by `buildPluginApi` below, shares
    // the same flag instead of each capturing its own.
    const frameState = { ended: false };

    try {
      const slotWidth = chartWidth / viewport.visibleCount;

      // x position for a *global* sorted-array index — honors the (possibly
      // fractional) viewport.startIndex so panning is pixel-smooth, not
      // stepped a whole point at a time. Shared by every pane: there is
      // only one time axis for the whole stack.
      const xForIndex = (globalIndex: number) => (globalIndex - viewport.startIndex) * slotWidth + slotWidth / 2;
      // Exact inverse of xForIndex above — solving
      // `x = (index - viewport.startIndex) * slotWidth + slotWidth / 2` for `index`.
      const indexForX = (x: number) => viewport.startIndex + (x - slotWidth / 2) / slotWidth;

      // save/restore isolates whatever canvas state a series's draw()
      // touches (lineWidth, line dash, ...) from the axis/crosshair/plugin
      // drawing that follows — the same isolation each plugin already gets
      // around its own draw() call below. Without this, a property no
      // series happened to set before (lineSeries.draw() is the first
      // built-in one to set ctx.lineWidth) would silently leak into every
      // subsequent stroke() this frame, including axis boundary lines,
      // grid lines, and the crosshair.
      ctx.save();
      try {
        seriesDefinition.draw(
          { ctx, visible, startIndex: startIdx, xForIndex, slotWidth, yScale, chartHeight },
          style,
        );
      } finally {
        ctx.restore();
      }

      const priceStep = this.currentPriceStep(valueMin, valueMax);
      this.renderPriceAxis(valueMin, valueMax, priceStep, yScale, chartWidth, chartHeight, mainRect.top);
      for (const { rect, min, max, scale } of paneScales) {
        this.renderPaneSeparator(rect.top, chartWidth);
        const step = this.currentPriceStep(min, max);
        this.renderPriceAxis(min, max, step, scale, chartWidth, rect.height, rect.top);
      }
      this.renderTimeAxis(times, startIdx, visible.length, stackHeight, chartWidth, xForIndex);

      if (hoverIndex !== null && hoverIndex >= startIdx && hoverIndex < endIdx) {
        // The dashed vertical line spans the whole stack (every pane); the
        // horizontal line, price-label chip, and OHLC legend stay scoped
        // to the main pane only — an indicator pane's own hover readout,
        // if it wants one, is the job of whatever plugin draws into it.
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
          stackHeight,
        );
      }

      if (plugins.length > 0) {
        // Everything every pane's PluginRenderApi shares — only the pane's
        // own rect/value-domain/scale differ between `buildPluginApi`
        // calls, so bundling the rest here keeps that call to a handful of
        // pane-specific arguments instead of ten positional ones repeated
        // per pane.
        const frameGeometry: FrameGeometry<TPoint> = {
          chartWidth,
          xForIndex,
          indexForX,
          visibleStartIndex: startIdx,
          visibleEndIndex: endIdx,
          allPoints: sorted,
          frameState,
        };
        const mainApi = this.buildPluginApi(mainRect, valueMin, valueMax, yScale, frameGeometry);
        const paneApiById = new Map<string, PluginRenderApi<TPoint>>();
        for (const { pane, rect, min, max, scale } of paneScales) {
          paneApiById.set(pane.id, this.buildPluginApi(rect, min, max, scale, frameGeometry));
        }

        for (const plugin of plugins) {
          if (plugin.visible === false) continue;
          // A paneId with no matching pane (e.g. the pane it targeted was
          // since removed) falls back to the main pane rather than being
          // silently skipped — see the doc comment on `ChartPlugin.paneId`.
          const api =
            plugin.paneId && plugin.paneId !== 'main' ? (paneApiById.get(plugin.paneId) ?? mainApi) : mainApi;
          // save/restore isolates each plugin's canvas state (strokeStyle,
          // lineDash, ...) from the next one — a plugin that forgets to
          // clean up after itself can't bleed style into whatever draws
          // after it. try/catch isolates failures the same way: one
          // plugin throwing shouldn't blank out the rest of the chart.
          ctx.save();
          try {
            plugin.draw(api);
          } catch (error) {
            console.error('wick-charts: a plugin threw during draw()', error);
          } finally {
            ctx.restore();
          }
        }
      }
    } finally {
      frameState.ended = true;
      disposeYScale();
      for (const { dispose } of paneScales) dispose();
    }
  }

  /**
   * Builds the `PluginRenderApi` for one pane — the main price pane or a
   * declared indicator pane, identical shape either way — from that pane's
   * own rect/value-domain/scale plus whatever `geometry` every pane shares
   * for this frame (shared because there is only one time axis, and one
   * frame-ended flag, for the whole stack; see `FrameGeometry`).
   */
  private buildPluginApi(
    rect: PaneRect,
    valueMin: number,
    valueMax: number,
    scale: Scale,
    geometry: FrameGeometry<TPoint>,
  ): PluginRenderApi<TPoint> {
    const { chartWidth, xForIndex, indexForX, visibleStartIndex, visibleEndIndex, allPoints, frameState } = geometry;
    return {
      ctx: this.ctx,
      chartWidth,
      chartHeight: rect.height,
      xForIndex,
      yForValue: (value) => {
        if (frameState.ended) {
          throw new Error(
            'wick-charts: PluginRenderApi.yForValue called after its frame ended — ' +
              'only call it synchronously inside ChartPlugin.draw()',
          );
        }
        // Local pane-space y (scale's range is [rect.height, 0]) shifted
        // into absolute canvas pixels by the pane's own top offset.
        return rect.top + scale.map(value);
      },
      indexForX,
      // Exact inverse of the mapping above: subtract the pane's top offset
      // before inverting the same [valueMin, valueMax] -> [rect.height, 0]
      // mapping createScale set up for it.
      valueForY: (y) => valueMin + (1 - (y - rect.top) / rect.height) * (valueMax - valueMin),
      visibleStartIndex,
      visibleEndIndex,
      allPoints,
    };
  }

  /** The decimal precision `formatPrice` should use for the current price
   * range — shared by the axis ticks and the crosshair's price label so
   * both display the same value with the same rounding. */
  private currentPriceStep(priceMin: number, priceMax: number): number {
    const ticks = niceTicks(priceMin, priceMax, this.axis.priceTickCount);
    return ticks.length > 1 ? ticks[1]! - ticks[0]! : 0;
  }

  /**
   * Draws one pane's right-side value axis: boundary line, horizontal grid
   * lines, and tick labels. Used for both the main price pane and every
   * indicator pane — `topOffset` shifts everything down by that pane's own
   * position in the stack (0 for the main pane, which sits at the top), so
   * `yScale` only ever has to know about its own pane-local [0, chartHeight]
   * range and never about where that pane lives in the full canvas.
   */
  private renderPriceAxis(
    priceMin: number,
    priceMax: number,
    step: number,
    yScale: Scale,
    chartWidth: number,
    chartHeight: number,
    topOffset: number,
  ): void {
    const { ctx, axis } = this;
    const ticks = niceTicks(priceMin, priceMax, axis.priceTickCount);

    ctx.strokeStyle = axis.lineColor;
    ctx.beginPath();
    ctx.moveTo(chartWidth + 0.5, topOffset);
    ctx.lineTo(chartWidth + 0.5, topOffset + chartHeight);
    ctx.stroke();

    ctx.font = this.axisFont();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    for (const value of ticks) {
      const localY = yScale.map(value);
      if (localY < 0 || localY > chartHeight) continue;
      const y = topOffset + localY;

      ctx.strokeStyle = axis.gridLineColor;
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(chartWidth, y + 0.5);
      ctx.stroke();

      ctx.fillStyle = axis.textColor;
      ctx.fillText(formatPrice(value, step), chartWidth + 6, y);
    }
  }

  /** The horizontal rule separating an indicator pane from whatever sits
   * above it (the main pane, or the previous indicator pane) — the same
   * `axis.lineColor` boundary style `renderTimeAxis` already draws between
   * the plotting area and the time-axis strip. */
  private renderPaneSeparator(top: number, chartWidth: number): void {
    const { ctx, axis } = this;
    ctx.strokeStyle = axis.lineColor;
    ctx.beginPath();
    ctx.moveTo(0, top + 0.5);
    ctx.lineTo(chartWidth, top + 0.5);
    ctx.stroke();
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
    stackHeight: number,
  ): void {
    const { ctx, canvas, seriesDefinition, style, crosshair } = this;

    ctx.save();
    ctx.strokeStyle = crosshair.lineColor;
    ctx.setLineDash([4, 4]);

    // Spans the whole pane stack (not just the main pane's own
    // chartHeight) so hovering a candle lines up with the same column
    // across every indicator pane below it — see the call site's comment
    // in `render()` for why the horizontal line/legend don't follow suit.
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, stackHeight);
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
