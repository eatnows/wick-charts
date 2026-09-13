import type { Scale } from '../hybridScale.js';
import type { LegendFormatContext, SeriesPoint, ValueRange } from '../types.js';

export type { ValueRange } from '../types.js';

/**
 * Everything a series's `draw` needs to turn its visible points into
 * pixels, precomputed once per frame by `ChartRenderer` so every series
 * type shares the exact same geometry (no series recomputes its own x
 * positions or re-derives the y scale).
 */
export interface SeriesDrawContext<TPoint extends SeriesPoint> {
  ctx: CanvasRenderingContext2D;
  /** The points currently in view, already sliced from the full sorted set. */
  visible: TPoint[];
  /** Global (full sorted-array) index of `visible[0]` — add a local offset
   * to it before calling `xForIndex`. */
  startIndex: number;
  /** Global-index -> x pixel. Already accounts for the viewport's
   * (possibly fractional) pan position, so panning stays pixel-smooth. */
  xForIndex: (globalIndex: number) => number;
  /** Pixel width of one candle/point's slot — series that draw a body
   * width or bar width derive it from this. */
  slotWidth: number;
  /** Value (price) -> y pixel for the current frame's domain. */
  yScale: Scale;
  chartHeight: number;
  /** Ratio between the canvas's backing-store size and its CSS display
   * size — 1 on a standard-DPI display, 2 on a typical Retina one. Every
   * geometric field above (`slotWidth`, `chartHeight`, the pixels `yScale`
   * maps to) is already in backing-store pixels, but a *literal* pixel
   * size in `style` (a stroke width, say — `LineStyle.lineWidth` is the
   * built-in example) is normally authored in CSS pixels, the same
   * intuitive unit `WickChartOptions.font`/`axis`/`crosshair`/`legend` use;
   * multiply such a field by this before setting it on `ctx` so it renders
   * at its intended visual size rather than half that on a 2x display. See
   * "High-DPI displays" in the README. */
  devicePixelRatio: number;
}

/**
 * The single seam a new chart type has to implement. `WickChart` and
 * `ChartRenderer` are written only against this interface — pan/zoom,
 * touch/mouse handling, on-demand data loading, and axis rendering never
 * need to know which concrete series is active. Adding a new chart type
 * (line, area, bar, ...) means writing one file that implements this
 * interface and calling `registerSeries` on it — see
 * `src/series/candlestick.ts` for the reference implementation and
 * `src/series/registry.ts` for how `type` strings resolve to a definition.
 */
export interface SeriesDefinition<TPoint extends SeriesPoint, TStyle> {
  /** Unique key — what `WickChartOptions.type` matches against. */
  readonly type: string;
  /** Style used when the caller doesn't override it via `WickChartOptions.style`. */
  readonly defaultStyle: TStyle;
  /** Computes the y-domain to auto-fit for the currently visible points,
   * before the user has manually panned/scaled the value axis (see
   * `Viewport.valueRangeOverride`). `scaleFactor` is the user's manual
   * vertical-zoom multiplier and should widen/narrow the fitted range
   * around its center, not replace it. */
  getValueRange(visible: TPoint[], scaleFactor: number): ValueRange;
  /** Draws the visible points for one frame. Must not read or mutate
   * anything outside `context` and `style` — `ChartRenderer` owns the
   * canvas lifecycle (clear/background/axes) around this call. */
  draw(context: SeriesDrawContext<TPoint>, style: TStyle): void;
  /** Builds the hover/crosshair legend text for one point, one string per
   * segment (joined with spacing by the renderer). Omit to draw the
   * crosshair line with no legend text. `context` gives access to
   * neighboring points (see `LegendFormatContext`) for anything the
   * hovered point alone can't express, like a value compared against the
   * previous point — this built-in series doesn't need it, but a custom
   * one can. `WickChartOptions.formatLegend`, when set, overrides this per
   * chart instance rather than per series type — see its own doc comment. */
  formatLegend?(point: TPoint, style: TStyle, context: LegendFormatContext<TPoint>): string[];
}
