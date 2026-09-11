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
 * A point in time for a candle. Deliberately a union of several shapes
 * instead of one flexible-but-ambiguous type, because time representation
 * is not universal across data sources:
 *  - a bare `number`: unix timestamp in **seconds**
 *  - `{ unixMs }`: unix timestamp in **milliseconds**
 *  - `{ businessDay }`: a calendar day with no time-of-day
 *  - a `string`: ISO 8601
 *
 * Adding a new source format means adding one case to `src/time.ts`'s
 * strategy list — this type and the call sites that consume `Candle` never
 * need to change.
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

export interface Candle extends SeriesPoint {
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
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
}
