import type { SeriesPoint } from '../types.js';

/**
 * What a plugin gets to draw with, rebuilt fresh by `ChartRenderer` every
 * frame from that frame's own geometry — a plugin never caches this across
 * renders, since panning/zooming changes every value here.
 *
 * Stronger than "don't cache it": `xForIndex` and `yForValue` must only be
 * called *synchronously*, inside the `draw()` call that received this
 * object. `yForValue` closes over the frame's `Scale`, which for a
 * large-enough series is WASM-backed and gets its backing memory freed the
 * moment `draw()` returns (see `ChartRenderer.render`'s `finally` block) —
 * stashing this object for a `setTimeout`, a promise callback, or the next
 * frame and calling `yForValue` from there is a use-after-free, not just a
 * staleness bug.
 */
export interface PluginRenderApi<TPoint extends SeriesPoint = SeriesPoint> {
  ctx: CanvasRenderingContext2D;
  chartWidth: number;
  chartHeight: number;
  /** Global (full sorted-array) index -> x pixel, same convention the
   * active series draws with. Valid only for the duration of this `draw()`
   * call — see the interface-level note on `PluginRenderApi`. */
  xForIndex: (globalIndex: number) => number;
  /** Value in the current frame's y-domain -> y pixel. Valid only for the
   * duration of this `draw()` call — see the interface-level note on
   * `PluginRenderApi`. */
  yForValue: (value: number) => number;
  /** Index range currently visible, global (sorted-array) indices. */
  visibleStartIndex: number;
  visibleEndIndex: number;
  /**
   * Every point currently loaded (not just visible), sorted ascending by
   * time — the same array the active series slices its own `visible` from.
   * A plugin that needs data outside the visible window (a moving average
   * needs `period - 1` points of "warm-up" history before the first
   * visible bar to be accurate there) reads from here rather than being
   * limited to `visibleStartIndex..visibleEndIndex`.
   */
  allPoints: readonly TPoint[];
}

/**
 * The extension point for anything that draws *on top of* a chart without
 * being the chart itself — price/event markers, alert lines, drawing
 * tools, annotations, indicator overlays. Register instances via
 * `CinderChart.addPlugin`; `ChartRenderer` calls `draw` once per frame,
 * after the active series and axes, so plugin output always sits above the
 * plotted data.
 *
 * This is deliberately a single narrow interface rather than a family of
 * marker/annotation/tool base classes — a plugin author owns their own
 * styling and reads whatever data it needs (candle fields, indicator
 * state, ...) off `allPoints`, and just needs pixel-space geometry for the
 * current frame, which `PluginRenderApi` provides. Generic over the same
 * `TPoint` the chart itself is generic over, so a candlestick chart's
 * plugins see `Candle`-shaped points without a cast.
 */
export interface ChartPlugin<TPoint extends SeriesPoint = SeriesPoint> {
  draw(api: PluginRenderApi<TPoint>): void;
}
