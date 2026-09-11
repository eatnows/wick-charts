const SECONDS_PER_DAY = 86_400;
const SECONDS_PER_90_DAYS = 90 * SECONDS_PER_DAY;

/**
 * Picks a label granularity from how wide a time range the axis is
 * covering — not from the interval between individual candles, since a
 * daily chart over a week and an hourly chart over a week should both
 * show dates, not times.
 */
export function formatAxisLabel(unixSeconds: number, spanSeconds: number): string {
  const iso = new Date(unixSeconds * 1000).toISOString();
  if (spanSeconds <= SECONDS_PER_DAY) return iso.slice(11, 16); // HH:mm
  if (spanSeconds <= SECONDS_PER_90_DAYS) return iso.slice(5, 10); // MM-DD
  return iso.slice(0, 7); // YYYY-MM
}

/**
 * Evenly-spaced indices into a `length`-long series, capped at `maxTicks`.
 * Used to decide which candles get an axis label — labeling every candle
 * would overlap into unreadable mush on anything but a tiny series.
 */
export function pickTickIndices(length: number, maxTicks: number): number[] {
  if (length <= 0) return [];
  if (length <= maxTicks) return Array.from({ length }, (_, i) => i);

  const step = (length - 1) / (maxTicks - 1);
  const indices = new Set<number>();
  for (let i = 0; i < maxTicks; i++) {
    indices.add(Math.round(i * step));
  }
  return Array.from(indices).sort((a, b) => a - b);
}
