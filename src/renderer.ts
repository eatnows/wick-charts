import { AxisRenderer } from './axisRenderer.js';
import { CrosshairRenderer } from './crosshairRenderer.js';
import { devicePixelRatio } from './devicePixelRatio.js';
import { createScale } from './hybridScale.js';
import { computePaneLayout } from './paneLayout.js';
import { pixelToValue, valueAxisPixelRange } from './valueAxis.js';
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
   * `CrosshairRenderer` for why that has to be the raw cursor position
   * rather than any property of the hovered point itself. */
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
 * The chart engine's renderer: owns the canvas lifecycle and orchestrates
 * one frame — deciding what data is visible, computing scales, and calling
 * out to collaborators for the actual pixel-pushing. None of it knows what
 * kind of series is on screen: the one series-specific seam is
 * `seriesDefinition`, injected at construction (see `src/series/types.ts`).
 * Stateless per call otherwise — all pan/zoom/hover state lives in
 * `Viewport` and `WickChart`; this class only turns a snapshot of that
 * state into pixels.
 *
 * Axis chrome and the hover crosshair/legend are drawn by two collaborators
 * (`AxisRenderer`, `CrosshairRenderer`) rather than methods on this class —
 * both take only already-resolved style options and per-call geometry, no
 * series generic or plugin state, so splitting them out keeps this file
 * focused on orchestration (what gets drawn, in what order, with what
 * scale) rather than mixing in how each individual chrome element paints.
 *
 * Every visual constant below (fonts, axis sizing/coloring, crosshair
 * coloring/padding, legend color) is resolved once at construction from
 * `WickChartOptions.font`/`axis`/`crosshair`/`legend`, each merged field
 * by field over its own defaults — nothing here is a hardcoded module
 * constant a caller can't reach. Every *size* among them (font sizes, axis
 * strip widths, padding, gaps) is specified in CSS pixels and scaled by the
 * canvas's live devicePixelRatio (see `deviceRatio`) at the top of every
 * `render()` call before use — colors and tick counts pass through
 * unscaled. `AxisRenderer`/`CrosshairRenderer` themselves stay unaware of
 * this: they're handed already-scaled options each frame, the same as they
 * were handed unscaled ones before this existed.
 */
export class ChartRenderer<TPoint extends SeriesPoint> {
  private ctx: CanvasRenderingContext2D;
  private background: string;
  private style: unknown;
  /** Author-facing (CSS-pixel) style groups, resolved once at construction
   * from `WickChartOptions.font`/`axis`/`crosshair`/`legend` — kept as
   * fields so `render()` can rescale them fresh every frame against the
   * canvas's current devicePixelRatio, which (a window dragged to a
   * different-DPI monitor, a browser zoom change, or the app simply
   * resizing the canvas) can change between frames. `axis` is additionally
   * read directly by `chartWidth`/`chartHeight`/`priceAxisWidth` below. */
  private axis: Required<ChartAxisOptions>;
  private font: Required<ChartFontOptions>;
  private crosshair: Required<ChartCrosshairOptions>;
  private legend: Required<ChartLegendOptions>;
  /** Unlike the style groups above, mutable after construction — see
   * `setInvertValueAxis`. A live toggle, not a one-time style choice, is
   * the whole point of this option (a "what if this series moved the
   * opposite way" view a user flips on and off), so it doesn't get the
   * "resolved once in the constructor" treatment those get. */
  private invertValueAxis: boolean;

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
    this.axis = { ...DEFAULT_AXIS, ...options.axis };
    this.invertValueAxis = options.invertValueAxis ?? false;
    this.font = { ...DEFAULT_FONT, ...options.font };
    this.crosshair = { ...DEFAULT_CROSSHAIR, ...options.crosshair };
    this.legend = { ...DEFAULT_LEGEND, ...options.legend };
  }

  setInvertValueAxis(inverted: boolean): void {
    this.invertValueAxis = inverted;
  }

  /** Ratio between the canvas's backing-store size and its CSS display
   * size — read live, not cached, for the same reason `chartWidth`/
   * `chartHeight` below read `canvas.width`/`height` live: whatever it is
   * *right now* is what this frame draws at. See `src/devicePixelRatio.ts`. */
  private get deviceRatio(): number {
    return devicePixelRatio(this.canvas, 'width');
  }

  /** Pixel width of the point-plotting area — excludes the price-axis
   * strip on the right. Exposed so `WickChart` can convert cursor pixel
   * positions to point indices / values for hit-testing and dragging.
   * `priceAxisWidth` below is already devicePixelRatio-scaled, so this
   * (and `chartHeight`) stay correct on a high-DPI canvas without
   * `WickChart` having to know anything about DPR itself. */
  get chartWidth(): number {
    return Math.max(0, this.canvas.width - this.priceAxisWidth);
  }

  get chartHeight(): number {
    return Math.max(0, this.canvas.height - this.axis.timeHeight * this.deviceRatio);
  }

  get priceAxisWidth(): number {
    return this.axis.priceWidth * this.deviceRatio;
  }

  render(input: RenderInput<TPoint>): void {
    const { ctx, canvas, background, seriesDefinition, style } = this;
    const { sorted, times, viewport, hoverIndex, hoverY, plugins, panes } = input;
    const ratio = this.deviceRatio;

    // Scaled fresh every frame (see `deviceRatio`'s own doc comment for
    // why this isn't done once at construction) — every *size* field gets
    // multiplied by `ratio`, every color/count field passes through as-is.
    // `AxisRenderer`/`CrosshairRenderer` are cheap POJO-ish collaborators
    // with no state beyond these options, so rebuilding them here each
    // frame is simpler than threading `ratio` through every one of their
    // methods for what's otherwise the same "resolved options" shape they
    // were built to take in the first place.
    const scaledAxis: Required<ChartAxisOptions> = {
      ...this.axis,
      priceWidth: this.axis.priceWidth * ratio,
      timeHeight: this.axis.timeHeight * ratio,
    };
    const scaledFont: Required<ChartFontOptions> = {
      ...this.font,
      axisSize: this.font.axisSize * ratio,
      legendSize: this.font.legendSize * ratio,
    };
    const scaledCrosshair: Required<ChartCrosshairOptions> = {
      ...this.crosshair,
      labelPaddingX: this.crosshair.labelPaddingX * ratio,
      labelPaddingY: this.crosshair.labelPaddingY * ratio,
    };
    const scaledLegend: Required<ChartLegendOptions> = {
      ...this.legend,
      paddingX: this.legend.paddingX * ratio,
      paddingY: this.legend.paddingY * ratio,
      cursorGap: this.legend.cursorGap * ratio,
    };
    const axisRenderer = new AxisRenderer(ctx, scaledAxis, scaledFont);
    const crosshairRenderer = new CrosshairRenderer(
      ctx,
      scaledCrosshair,
      scaledLegend,
      scaledFont,
      scaledAxis.priceWidth,
    );

    const width = canvas.width;
    const height = canvas.height;
    // Computed from `scaledAxis` (already built from `ratio` above) rather
    // than by re-reading `this.chartWidth`/`chartHeight` — those getters
    // recompute `deviceRatio`, which reads `getBoundingClientRect()` (a
    // potential layout reflow in a real browser); doing that three times
    // per frame instead of once matters at 60fps.
    const chartWidth = Math.max(0, width - scaledAxis.priceWidth);
    // Full stack height: the main price pane plus every declared indicator
    // pane below it. `this.chartHeight` predates panes and named what's
    // now only true with zero of them — kept as the property name (public
    // API reads it through) but renamed locally here since most of this
    // method cares about one pane's height, not the stack's.
    const stackHeight = Math.max(0, height - scaledAxis.timeHeight);

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
    // valueAxisPixelRange picks which pixel end is the domain minimum —
    // the one thing invertValueAxis actually changes about this call.
    const { scale: yScale, dispose: disposeYScale } = createScale(
      valueMin,
      valueMax,
      ...valueAxisPixelRange(chartHeight, this.invertValueAxis),
      visible.length,
    );

    // Every indicator pane gets the exact same treatment as the main pane
    // — its own value domain (from `PaneOptions.getValueRange`) and its
    // own JS/WASM scale over its own pixel height — kept alive for the
    // whole frame alongside `yScale`, since plugins targeting a pane draw
    // only after every pane's axis has already been rendered. Inverted the
    // same way as the main pane so a chart's invertValueAxis option
    // mirrors its whole stack consistently, not just the price pane.
    const paneScales = paneRects.map((rect, i) => {
      const pane = panes[i]!;
      const { min, max } = pane.getValueRange();
      const { scale, dispose } = createScale(
        min,
        max,
        ...valueAxisPixelRange(rect.height, this.invertValueAxis),
        visible.length,
      );
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
          { ctx, visible, startIndex: startIdx, xForIndex, slotWidth, yScale, chartHeight, devicePixelRatio: ratio },
          style,
        );
      } finally {
        ctx.restore();
      }

      const priceStep = axisRenderer.priceStep(valueMin, valueMax);
      axisRenderer.renderPriceAxis(valueMin, valueMax, priceStep, yScale, chartWidth, chartHeight, mainRect.top);
      for (const { rect, min, max, scale } of paneScales) {
        axisRenderer.renderPaneSeparator(rect.top, chartWidth);
        const step = axisRenderer.priceStep(min, max);
        axisRenderer.renderPriceAxis(min, max, step, scale, chartWidth, rect.height, rect.top);
      }
      axisRenderer.renderTimeAxis(times, startIdx, visible.length, stackHeight, chartWidth, xForIndex);

      if (hoverIndex !== null && hoverIndex >= startIdx && hoverIndex < endIdx) {
        // The dashed vertical line spans the whole stack (every pane); the
        // horizontal line, price-label chip, and OHLC legend stay scoped
        // to the main pane only — an indicator pane's own hover readout,
        // if it wants one, is the job of whatever plugin draws into it.
        const legendParts = seriesDefinition.formatLegend?.(sorted[hoverIndex]!, style) ?? [];
        crosshairRenderer.render({
          x: xForIndex(hoverIndex),
          timeSeconds: times[hoverIndex]!,
          hoverY,
          valueMin,
          valueMax,
          priceStep,
          chartWidth,
          chartHeight,
          stackHeight,
          invertValueAxis: this.invertValueAxis,
          legendParts,
          canvasWidth: canvas.width,
        });
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
        const mainApi = this.buildPluginApi(mainRect, valueMin, valueMax, yScale, frameGeometry, ratio);
        const paneApiById = new Map<string, PluginRenderApi<TPoint>>();
        for (const { pane, rect, min, max, scale } of paneScales) {
          paneApiById.set(pane.id, this.buildPluginApi(rect, min, max, scale, frameGeometry, ratio));
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
    devicePixelRatio: number,
  ): PluginRenderApi<TPoint> {
    const { chartWidth, xForIndex, indexForX, visibleStartIndex, visibleEndIndex, allPoints, frameState } = geometry;
    return {
      ctx: this.ctx,
      chartWidth,
      chartHeight: rect.height,
      devicePixelRatio,
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
      // before inverting the same value<->pixel mapping createScale set up
      // for it (see src/valueAxis.ts — same invertValueAxis flag, so this
      // stays consistent with whichever direction the pane actually drew in).
      valueForY: (y) => pixelToValue(y - rect.top, valueMin, valueMax, rect.height, this.invertValueAxis),
      visibleStartIndex,
      visibleEndIndex,
      allPoints,
    };
  }
}
