import { computeSma } from '../indicators/sma.js';
import type { ChartPlugin, PluginRenderApi } from './types.js';
import type { Candle } from '../types.js';

export interface MovingAveragePluginOptions {
  /** Window size, in candles. Defaults to 20. */
  period?: number;
  /** Line color. Defaults to a warm amber that reads clearly over both
   * up and down candle colors. */
  color?: string;
  lineWidth?: number;
  /** Which field to average. Defaults to closing price — override to
   * average highs, lows, or anything else a `Candle` carries. Named
   * `accessor` rather than `valueOf` — the latter collides with
   * `Object.prototype.valueOf` and breaks structural type-checking on
   * this options object. */
  accessor?: (candle: Candle) => number;
}

const DEFAULT_PERIOD = 20;
const DEFAULT_COLOR = '#f0b90b';
const DEFAULT_LINE_WIDTH = 1.5;
const DEFAULT_ACCESSOR = (candle: Candle): number => candle.close;

/**
 * A simple-moving-average overlay — the reference `ChartPlugin`
 * implementation (see `src/plugins/types.ts`): it owns its own data
 * access (reading closes off `PluginRenderApi.allPoints`, not just the
 * visible slice, so the line is accurate from the very first visible
 * candle instead of needing `period - 1` candles of on-screen warm-up)
 * and draws with nothing but the pixel-space geometry every plugin gets.
 *
 * Recomputes the average over the *entire* loaded series on every frame,
 * same as the renderer recomputes its own value range every frame —
 * simple and correct; `computeSma` reaches for the WASM path once the
 * series is long enough for that to matter (see `src/indicators/sma.ts`).
 */
export function createMovingAveragePlugin(options: MovingAveragePluginOptions = {}): ChartPlugin<Candle> {
  const period = options.period ?? DEFAULT_PERIOD;
  const color = options.color ?? DEFAULT_COLOR;
  const lineWidth = options.lineWidth ?? DEFAULT_LINE_WIDTH;
  const accessor = options.accessor ?? DEFAULT_ACCESSOR;

  return {
    draw(api: PluginRenderApi<Candle>): void {
      const { ctx, allPoints, visibleStartIndex, visibleEndIndex, xForIndex, yForValue } = api;
      if (allPoints.length === 0) return;

      const values = computeSma(
        allPoints.map((candle) => accessor(candle)),
        period,
      );

      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.beginPath();

      // NaN marks the warm-up region (see computeSma) — breaks the line
      // into a fresh subpath rather than drawing through a gap.
      let drawing = false;
      for (let i = visibleStartIndex; i < visibleEndIndex; i++) {
        const value = values[i];
        if (value === undefined || Number.isNaN(value)) {
          drawing = false;
          continue;
        }
        const x = xForIndex(i);
        const y = yForValue(value);
        if (drawing) {
          ctx.lineTo(x, y);
        } else {
          ctx.moveTo(x, y);
          drawing = true;
        }
      }

      ctx.stroke();
    },
  };
}
