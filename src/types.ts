/** A calendar day with no time-of-day component. */
export interface BusinessDay {
  year: number;
  month: number; // 1-12
  day: number;
}

/** Explicit unix-milliseconds wrapper — disambiguates from the implicit
 * unix-*seconds* convention that a bare `number` carries (see src/time.ts).
 * Millisecond timestamps are a common source format in the wild. */
export interface UnixMillis {
  unixMs: number;
}

/**
 * A point in time for any plotted point (candle, line point, etc.).
 * Deliberately a union of several shapes instead of one
 * flexible-but-ambiguous type, because time representation is not
 * universal across data sources:
 *  - a bare `number`: unix timestamp in **seconds**
 *  - `{ unixMs }`: unix timestamp in **milliseconds**
 *  - `{ businessDay }`: a calendar day with no time-of-day
 *  - a `string`: ISO 8601
 *
 * Adding a new source format means adding one case to `src/time.ts`'s
 * strategy list — this type and the call sites that consume `SeriesPoint`
 * never need to change.
 */
export type CinderTime = number | string | UnixMillis | { businessDay: BusinessDay };

/**
 * The minimum shape every plotted point must have, regardless of chart
 * type — a time to place it on the x-axis. `Candle` (OHLC) is one instance
 * of this; a future line/area/bar series point is another. Everything in
 * the engine that doesn't need to know *what* is plotted (pan/zoom, event
 * handling, data loading, merging) is written against this shape, not
 * against `Candle` — see `src/series/types.ts` for where the per-type
 * behavior (drawing, value-range, legend text) actually lives.
 */
export interface SeriesPoint {
  time: CinderTime;
}

/**
 * A y-domain — a value axis range. The single `{min, max}` shape shared by
 * `SeriesDefinition.getValueRange`'s result, `Viewport.valueRangeOverride`,
 * and `src/priceRange.ts`'s `fitRange` helper, so all three talk about "the
 * currently plotted range" the same way regardless of which series (or
 * whether the user has manually overridden the axis) produced it.
 */
export interface ValueRange {
  min: number;
  max: number;
}

export interface Candle extends SeriesPoint {
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

/** Text styling shared by every label the chart draws — axis ticks,
 * crosshair axis labels, and the hover legend. `axisSize`/`legendSize` are
 * separate since the legend has historically been drawn one px larger to
 * stand out as the "primary" hover readout; override either independently. */
export interface ChartFontOptions {
  /** CSS font family. Defaults to `'sans-serif'`. */
  family?: string;
  /** Size, in px, of price/time axis tick labels and crosshair axis labels. Defaults to 10. */
  axisSize?: number;
  /** Size, in px, of the hover legend text. Defaults to 11. */
  legendSize?: number;
}

/** Sizing and coloring for the price/time axis strips and their grid lines
 * — engine-level, not part of any series's own style, since every series
 * type shares the same two axes regardless of what it plots. */
export interface ChartAxisOptions {
  /** Width, in px, of the price-axis strip on the right. Defaults to 64. */
  priceWidth?: number;
  /** Height, in px, of the time-axis strip at the bottom. Defaults to 24. */
  timeHeight?: number;
  /** Target number of price-axis tick labels. Defaults to 5. */
  priceTickCount?: number;
  /** Maximum number of time-axis tick labels. Defaults to 6. */
  timeMaxTicks?: number;
  /** Tick label color. Defaults to `'#787878'`. */
  textColor?: string;
  /** Color of the two axis boundary lines. Defaults to `'#33333333'`. */
  lineColor?: string;
  /** Color of the horizontal price gridlines. Defaults to `'#2a2a2a55'`. */
  gridLineColor?: string;
}

/** Coloring and padding for the hover crosshair's lines and its two
 * highlighted axis-label chips. */
export interface ChartCrosshairOptions {
  /** Dashed crosshair line color. Defaults to `'#9090904d'`. */
  lineColor?: string;
  /** Background fill of the price/time label chips. Defaults to `'#3a3a3a'`. */
  labelBackground?: string;
  /** Text color inside the label chips. Defaults to `'#f0f0f0'`. */
  labelTextColor?: string;
  /** Horizontal padding, in px, inside each label chip. Defaults to 4. */
  labelPaddingX?: number;
  /** Vertical padding, in px, inside each label chip. Defaults to 3. */
  labelPaddingY?: number;
}

/** Styling for the top-left hover legend (the OHLC(+volume) line). */
export interface ChartLegendOptions {
  /** Legend text color. Defaults to `'#c8c8c8'`. */
  textColor?: string;
}

export interface CinderChartOptions {
  /**
   * Which registered series type to render this chart as (see
   * `registerSeries` in `src/series/registry.ts`). Defaults to
   * `'candlestick'`, the only type built into the library today — adding a
   * new one is a matter of implementing `SeriesDefinition` and registering
   * it, without changing `CinderChart` or `ChartRenderer` at all.
   */
  type?: string;
  /** Background color of the canvas. Defaults to transparent. Chart-wide
   * (the renderer clears/fills the whole canvas with it), not part of any
   * series's own style. */
  background?: string;
  /**
   * Style overrides specific to the chosen `type` — shape depends on which
   * series is active (candlestick's is `CandlestickStyle`). Merged over the
   * series definition's `defaultStyle`.
   */
  style?: Record<string, unknown>;
  /** Font family/sizes for every label the chart draws. Merged over the
   * built-in defaults field by field — set only what you want to change. */
  font?: ChartFontOptions;
  /** Price/time axis sizing, tick counts, and coloring. Merged over the
   * built-in defaults field by field. */
  axis?: ChartAxisOptions;
  /** Hover crosshair line/label coloring and padding. Merged over the
   * built-in defaults field by field. */
  crosshair?: ChartCrosshairOptions;
  /** Hover legend coloring. Merged over the built-in defaults field by field. */
  legend?: ChartLegendOptions;
}
