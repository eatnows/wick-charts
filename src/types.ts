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

export interface Candle {
  time: CinderTime;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface CinderChartOptions {
  /** Background color of the canvas. Defaults to transparent. */
  background?: string;
  /** Candle body color for up (close >= open) bars. */
  upColor?: string;
  /** Candle body color for down (close < open) bars. */
  downColor?: string;
}
