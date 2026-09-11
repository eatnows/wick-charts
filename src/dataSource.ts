import type { Candle, SeriesPoint } from './types.js';

export interface DataRequest {
  /** 'before' = the user panned toward older history; 'after' = toward
   * newer/future data. */
  direction: 'before' | 'after';
  /** Unix seconds. For 'before', return candles with time < boundary; for
   * 'after', time > boundary. This is always the earliest ('before') or
   * latest ('after') time currently loaded — never a guess. */
  boundary: number;
  /** A hint for how many candles would satisfy this request, not a hard
   * requirement — the loader may return more, fewer, or none (an empty
   * array/resolved-empty tells the chart "no more data in this direction,"
   * and it stops asking until `setData` resets that). */
  count: number;
}

/** Given a request, resolve with the points that satisfy it (any order,
 * any overlap with what's already loaded — `mergeSeriesPoints` handles
 * both). Sync or async; the chart awaits either. Errors are swallowed by
 * the chart (a failed fetch just means it tries again next time the
 * viewport crosses the threshold) — callers that need to surface failures
 * should catch inside the loader and resolve `[]`. Generic over `TPoint`
 * (defaulted to `Candle`) so a future non-candle series can use the same
 * on-demand loading mechanism. */
export type DataLoader<TPoint extends SeriesPoint = Candle> = (
  request: DataRequest,
) => TPoint[] | Promise<TPoint[]>;
