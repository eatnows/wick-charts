import { fitRange } from '../priceRange.js';
import { registerSeries } from './registry.js';
import type { Candle } from '../types.js';
import type { SeriesDefinition, SeriesDrawContext, ValueRange } from './types.js';

export interface CandlestickStyle {
  /** Candle body/wick color for up (close >= open) bars. */
  upColor: string;
  /** Candle body/wick color for down (close < open) bars. */
  downColor: string;
  /** Candle body/wick width as a fraction of the available per-candle slot
   * width (the rest is inter-candle gap). Defaults to 0.6. */
  bodyWidthRatio: number;
  /** Fraction of the chart's full height that volume bars occupy, measured
   * up from the bottom. Candles still use the full height for their own
   * price scale regardless of this value — the bars sit in this bottom
   * margin, layered underneath. Defaults to 0.2. */
  volumeAreaHeightRatio: number;
  /** Opacity (0-1) of the volume bars, so they read as a backdrop rather
   * than competing with the candles drawn over them. Defaults to 0.5. */
  volumeBarOpacity: number;
}

const DEFAULT_STYLE: CandlestickStyle = {
  upColor: '#26a69a',
  downColor: '#ef5350',
  bodyWidthRatio: 0.6,
  volumeAreaHeightRatio: 0.2,
  volumeBarOpacity: 0.5,
};

function getValueRange(visible: Candle[], scaleFactor: number): ValueRange {
  const rawMin = Math.min(...visible.map((c) => c.low));
  const rawMax = Math.max(...visible.map((c) => c.high));
  return fitRange(rawMin, rawMax, scaleFactor);
}

/** Draws a volume bar per candle that has one, scaled against the largest
 * volume currently visible. A no-op — nothing reserved, nothing drawn —
 * when not a single visible candle has `volume` set, so charts built from
 * OHLC-only data look exactly as they did before this existed. */
function drawVolumeBars(context: SeriesDrawContext<Candle>, style: CandlestickStyle): void {
  const { ctx, visible, startIndex, xForIndex, slotWidth, chartHeight } = context;

  const maxVolume = visible.reduce((max, c) => (c.volume !== undefined ? Math.max(max, c.volume) : max), 0);
  if (maxVolume <= 0) return;

  const areaHeight = chartHeight * style.volumeAreaHeightRatio;
  const bodyWidth = Math.max(1, slotWidth * style.bodyWidthRatio);

  ctx.globalAlpha = style.volumeBarOpacity;
  visible.forEach((candle, i) => {
    if (candle.volume === undefined) return;
    const x = xForIndex(startIndex + i);
    const barHeight = Math.max(1, (candle.volume / maxVolume) * areaHeight);
    ctx.fillStyle = candle.close >= candle.open ? style.upColor : style.downColor;
    ctx.fillRect(x - bodyWidth / 2, chartHeight - barHeight, bodyWidth, barHeight);
  });
  ctx.globalAlpha = 1;
}

function draw(context: SeriesDrawContext<Candle>, style: CandlestickStyle): void {
  const { ctx, visible, startIndex, xForIndex, slotWidth, yScale } = context;
  const bodyWidth = Math.max(1, slotWidth * style.bodyWidthRatio);

  // Drawn first so the (opaque) candles render on top of the (translucent)
  // volume bars where the two overlap near the bottom of the chart.
  drawVolumeBars(context, style);

  // Batched through mapMany (one call per array) rather than four map()
  // calls per candle in the loop below — the batch is what lets the WASM
  // path pay the JS<->WASM boundary cost once per frame instead of once
  // per point.
  const yHighs = yScale.mapMany(visible.map((c) => c.high));
  const yLows = yScale.mapMany(visible.map((c) => c.low));
  const yOpens = yScale.mapMany(visible.map((c) => c.open));
  const yCloses = yScale.mapMany(visible.map((c) => c.close));

  visible.forEach((candle, i) => {
    const x = xForIndex(startIndex + i);
    const isUp = candle.close >= candle.open;
    ctx.strokeStyle = ctx.fillStyle = isUp ? style.upColor : style.downColor;

    ctx.beginPath();
    ctx.moveTo(x, yHighs[i]!);
    ctx.lineTo(x, yLows[i]!);
    ctx.stroke();

    const yOpen = yOpens[i]!;
    const yClose = yCloses[i]!;
    const top = Math.min(yOpen, yClose);
    const bodyHeight = Math.max(1, Math.abs(yClose - yOpen));
    ctx.fillRect(x - bodyWidth / 2, top, bodyWidth, bodyHeight);
  });
}

function formatLegend(candle: Candle): string[] {
  const parts = [
    `O ${candle.open.toLocaleString('en-US')}`,
    `H ${candle.high.toLocaleString('en-US')}`,
    `L ${candle.low.toLocaleString('en-US')}`,
    `C ${candle.close.toLocaleString('en-US')}`,
  ];
  if (candle.volume !== undefined) {
    parts.push(`Vol ${candle.volume.toLocaleString('en-US')}`);
  }
  return parts;
}

export const candlestickSeries: SeriesDefinition<Candle, CandlestickStyle> = {
  type: 'candlestick',
  defaultStyle: DEFAULT_STYLE,
  getValueRange,
  draw,
  formatLegend,
};

// Registered as a module-level side effect so importing this file (which
// src/index.ts always does) is enough to make 'candlestick' available —
// callers never register the built-in type themselves.
registerSeries(candlestickSeries);
