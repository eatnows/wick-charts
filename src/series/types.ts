import type { Scale } from '../hybridScale.js';
import type { SeriesPoint, ValueRange } from '../types.js';

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
}

/**
 * The single seam a new chart type has to implement. `CinderChart` and
 * `ChartRenderer` are written only against this interface — pan/zoom,
 * touch/mouse handling, on-demand data loading, and axis rendering never
 * need to know which concrete series is active. Adding a new chart type
 * (line, area, bar, ...) means writing one file that implements this
 * interface and calling `registerSeries` on it — see
 * `src/series/candlestick.ts` for the reference implementation and
 * `src/series/registry.ts` for how `type` strings resolve to a definition.
 */
export interface SeriesDefinition<TPoint extends SeriesPoint, TStyle> {
  /** Unique key — what `CinderChartOptions.type` matches against. */
  readonly type: string;
  /** Style used when the caller doesn't override it via `CinderChartOptions.style`. */
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
   * crosshair line with no legend text. */
  formatLegend?(point: TPoint, style: TStyle): string[];
  /** The single value (in this series's y-domain) the horizontal crosshair
   * line and price-axis label lock onto for a hovered point — a candle's
   * close, say. Omit if the series has no one natural value to point at;
   * the crosshair then draws its vertical line and legend only, with no
   * horizontal line or price-axis label. */
  getPrimaryValue?(point: TPoint, style: TStyle): number;
}
