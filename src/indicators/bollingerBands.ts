import { computeSma } from './sma.js';
import { forEachValidRun } from './runs.js';
import type { ChartPlugin, PluginRenderApi } from '../plugins/types.js';
import type { Candle } from '../types.js';

export interface BollingerBandsPluginOptions {
  /** Window size, in candles, for both the middle band and the standard
   * deviation. Defaults to 20. */
  period?: number;
  /** How many standard deviations the upper/lower bands sit from the
   * middle band. Defaults to 2 (the standard convention). */
  stdDevMultiplier?: number;
  /** Middle band (a plain SMA) line color. */
  middleColor?: string;
  /** Upper/lower band line color. */
  bandColor?: string;
  /** Fill color between the upper and lower bands. Defaults to `bandColor`
   * — see `fillOpacity` for how faded it is. */
  fillColor?: string;
  /** Opacity (0-1) of the fill between the bands. Defaults to 0.15. */
  fillOpacity?: number;
  lineWidth?: number;
  /** Which field the bands are computed from. Defaults to closing price. */
  accessor?: (candle: Candle) => number;
}

const DEFAULT_PERIOD = 20;
const DEFAULT_STD_DEV_MULTIPLIER = 2;
const DEFAULT_MIDDLE_COLOR = '#6c72ff';
const DEFAULT_BAND_COLOR = '#6c72ff';
const DEFAULT_FILL_OPACITY = 0.15;
const DEFAULT_LINE_WIDTH = 1;
const DEFAULT_ACCESSOR = (candle: Candle): number => candle.close;

/**
 * Population standard deviation over a sliding window of `period`, one
 * entry per index — NaN wherever `means` (the same window's already-
 * computed average) is NaN, so it shares `computeSma`'s exact warm-up
 * convention rather than deriving its own. `period` is small in every
 * realistic use (20 is the standard convention), so this stays a plain
 * O(n * period) loop rather than a sliding sum-of-squares — simple and
 * numerically exact, at a cost that hasn't shown up as worth avoiding.
 */
function rollingStdDev(values: number[], means: number[], period: number): number[] {
  return means.map((mean, i) => {
    if (Number.isNaN(mean)) return NaN;
    let sumSquaredDiff = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const diff = values[j]! - mean;
      sumSquaredDiff += diff * diff;
    }
    return Math.sqrt(sumSquaredDiff / period);
  });
}

function strokeLine(
  ctx: CanvasRenderingContext2D,
  runStart: number,
  runEnd: number,
  values: number[],
  xForIndex: (i: number) => number,
  yForValue: (v: number) => number,
  color: string,
  lineWidth: number,
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  for (let i = runStart; i < runEnd; i++) {
    const x = xForIndex(i);
    const y = yForValue(values[i]!);
    if (i === runStart) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

/**
 * Bollinger Bands: a middle SMA plus upper/lower bands `stdDevMultiplier`
 * standard deviations away, with the area between them filled. Built the
 * same way as `createMovingAveragePlugin` — its own `ChartPlugin`, reading
 * straight off `PluginRenderApi.allPoints` so all three lines are accurate
 * from the first visible candle instead of needing `period - 1` candles of
 * on-screen warm-up, and gap-aware via `forEachValidRun` so nothing draws
 * a line straight through the warm-up region.
 */
export function createBollingerBandsPlugin(options: BollingerBandsPluginOptions = {}): ChartPlugin<Candle> {
  const period = options.period ?? DEFAULT_PERIOD;
  const multiplier = options.stdDevMultiplier ?? DEFAULT_STD_DEV_MULTIPLIER;
  const middleColor = options.middleColor ?? DEFAULT_MIDDLE_COLOR;
  const bandColor = options.bandColor ?? DEFAULT_BAND_COLOR;
  const fillColor = options.fillColor ?? bandColor;
  const fillOpacity = options.fillOpacity ?? DEFAULT_FILL_OPACITY;
  const lineWidth = options.lineWidth ?? DEFAULT_LINE_WIDTH;
  const accessor = options.accessor ?? DEFAULT_ACCESSOR;

  return {
    draw(api: PluginRenderApi<Candle>): void {
      const { ctx, allPoints, visibleStartIndex, visibleEndIndex, xForIndex, yForValue } = api;
      if (allPoints.length === 0) return;

      const values = allPoints.map((candle) => accessor(candle));
      const middle = computeSma(values, period);
      const stdDev = rollingStdDev(values, middle, period);
      const upper = middle.map((m, i) => m + multiplier * stdDev[i]!);
      const lower = middle.map((m, i) => m - multiplier * stdDev[i]!);

      forEachValidRun(
        visibleStartIndex,
        visibleEndIndex,
        (i) => !Number.isNaN(middle[i]),
        (runStart, runEnd) => {
          // Fill first so the band/middle lines draw on top of it.
          ctx.beginPath();
          for (let i = runStart; i < runEnd; i++) {
            const x = xForIndex(i);
            const y = yForValue(upper[i]!);
            if (i === runStart) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          for (let i = runEnd - 1; i >= runStart; i--) {
            ctx.lineTo(xForIndex(i), yForValue(lower[i]!));
          }
          ctx.closePath();
          ctx.globalAlpha = fillOpacity;
          ctx.fillStyle = fillColor;
          ctx.fill();
          ctx.globalAlpha = 1;

          strokeLine(ctx, runStart, runEnd, upper, xForIndex, yForValue, bandColor, lineWidth);
          strokeLine(ctx, runStart, runEnd, lower, xForIndex, yForValue, bandColor, lineWidth);
          strokeLine(ctx, runStart, runEnd, middle, xForIndex, yForValue, middleColor, lineWidth);
        },
      );
    },
  };
}
