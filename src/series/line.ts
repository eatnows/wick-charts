import { fitRange } from '../priceRange.js';
import { registerSeries } from './registry.js';
import type { LinePoint } from '../types.js';
import type { SeriesDefinition, SeriesDrawContext, ValueRange } from './types.js';

/** The second built-in series type — a plain single-value line, the
 * simplest possible `SeriesDefinition` beyond candlestick's OHLC. Exists as
 * much to exercise the registry with a genuinely different `TPoint`/`TStyle`
 * pair as to be useful on its own; see `src/series/candlestick.ts` for the
 * reference implementation this mirrors. */
export interface LineStyle {
  /** Stroke color. Defaults to `'#2196f3'`. */
  lineColor: string;
  /** Stroke width, in px. Defaults to 1.5. */
  lineWidth: number;
}

const DEFAULT_STYLE: LineStyle = {
  lineColor: '#2196f3',
  lineWidth: 1.5,
};

/** Falls back to a fixed `[0, 1]` range when every visible point is a gap
 * (`NaN`/non-finite `value`) — `Math.min()`/`Math.max()` over an empty
 * array are `Infinity`/`-Infinity`, which would otherwise feed `fitRange`
 * a `NaN` midpoint. Candlestick never needs this: `Candle`'s OHLC fields
 * aren't optional or gap-tolerant the way a line point's `value` is. */
function getValueRange(visible: LinePoint[], scaleFactor: number): ValueRange {
  const values = visible.map((p) => p.value).filter((v) => Number.isFinite(v));
  if (values.length === 0) return { min: 0, max: 1 };
  return fitRange(Math.min(...values), Math.max(...values), scaleFactor);
}

function draw(context: SeriesDrawContext<LinePoint>, style: LineStyle): void {
  const { ctx, visible, startIndex, xForIndex, yScale, devicePixelRatio } = context;
  if (visible.length === 0) return;

  // Batched through mapMany (one call per array) rather than once per
  // point in the loop below — same reasoning as candlestick's draw(): it's
  // what lets the WASM path pay the JS<->WASM boundary cost once per frame.
  // NaN values map to NaN here, harmlessly — skipped below rather than
  // filtered out first, so `ys[i]` still lines up with `visible[i]`.
  const ys = yScale.mapMany(visible.map((p) => p.value));

  ctx.strokeStyle = style.lineColor;
  // `lineWidth` is authored in CSS pixels, like every other size in
  // `WickChartOptions` — scaled to backing-store pixels here so the stroke
  // renders at its intended visual thickness on a high-DPI canvas instead
  // of half that. See `SeriesDrawContext.devicePixelRatio`.
  ctx.lineWidth = style.lineWidth * devicePixelRatio;
  ctx.beginPath();

  // `drawing` tracks whether the path is mid-segment — a non-finite value
  // (a gap in the data) breaks it, and the line resumes fresh at the next
  // real value rather than jumping straight across the gap.
  let drawing = false;
  visible.forEach((point, i) => {
    if (!Number.isFinite(point.value)) {
      drawing = false;
      return;
    }
    const x = xForIndex(startIndex + i);
    const y = ys[i]!;
    if (drawing) {
      ctx.lineTo(x, y);
    } else {
      ctx.moveTo(x, y);
      drawing = true;
    }
  });
  ctx.stroke();
}

function formatLegend(point: LinePoint): string[] {
  return [`Value ${Number.isFinite(point.value) ? point.value.toLocaleString('en-US') : '—'}`];
}

export const lineSeries: SeriesDefinition<LinePoint, LineStyle> = {
  type: 'line',
  defaultStyle: DEFAULT_STYLE,
  getValueRange,
  draw,
  formatLegend,
};

// Registered as a module-level side effect, same as candlestickSeries — see
// src/series/candlestick.ts for why. src/index.ts imports this file so
// 'line' is available the moment the package itself is imported.
registerSeries(lineSeries);
