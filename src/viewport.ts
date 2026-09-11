import type { PriceRange } from './priceRange.js';

const MIN_VISIBLE_COUNT = 5;
const MIN_PRICE_SCALE_FACTOR = 0.5;
const MAX_PRICE_SCALE_FACTOR = 8;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Pure pan/zoom/price-scale state — no DOM, no canvas. `CinderChart` owns
 * translating pixel deltas (drag distance, wheel delta) into calls here;
 * this class only owns the resulting numbers, which keeps it unit-testable
 * without a canvas.
 */
export class Viewport {
  startIndex: number;
  visibleCount: number;
  /** 1 = auto-fit price range. >1 widens it (candles look shorter/compressed).
   * <1 narrows it (candles look taller), clamped so real data never clips
   * off-screen. Sign of drag→factor mapping lives in CinderChart, not here. */
  priceScaleFactor = 1;

  /** Manually-set price range from a vertical drag or price-axis scale.
   * `null` until the user first touches the price axis — while `null` the
   * renderer auto-fits (see `autoFitPriceRange`) using `priceScaleFactor`
   * alone. Once set, auto-fit stops applying: the user has taken explicit
   * control of the axis, so the chart stops recentering it under them. */
  priceRangeOverride: PriceRange | null = null;

  constructor(totalCount: number, visibleCount?: number) {
    this.visibleCount = clamp(visibleCount ?? totalCount, MIN_VISIBLE_COUNT, Math.max(totalCount, MIN_VISIBLE_COUNT));
    this.startIndex = clamp(totalCount - this.visibleCount, 0, Math.max(0, totalCount - this.visibleCount));
  }

  get endIndex(): number {
    return this.startIndex + this.visibleCount;
  }

  /** Shifts the visible window. Positive `deltaCandles` moves forward in
   * time (later candles come into view on the right). Clamped so the
   * window never leaves [0, totalCount] — no overscroll past the data. */
  pan(deltaCandles: number, totalCount: number): void {
    const maxStart = Math.max(0, totalCount - this.visibleCount);
    this.startIndex = clamp(this.startIndex + deltaCandles, 0, maxStart);
  }

  /** Scales the visible window by `factor` (>1 zooms out, <1 zooms in),
   * keeping the candle at `anchorIndex` under the same relative position —
   * the standard "zoom toward the cursor" feel. */
  zoom(factor: number, anchorIndex: number, totalCount: number): void {
    const newVisibleCount = clamp(this.visibleCount * factor, MIN_VISIBLE_COUNT, totalCount);
    const anchorRatio = this.visibleCount === 0 ? 0.5 : (anchorIndex - this.startIndex) / this.visibleCount;

    this.visibleCount = newVisibleCount;
    const maxStart = Math.max(0, totalCount - this.visibleCount);
    this.startIndex = clamp(anchorIndex - anchorRatio * newVisibleCount, 0, maxStart);
  }

  /** Multiplies the price-scale factor, clamped to a sane range so the
   * price axis can't be dragged into showing nothing or clipping data.
   * Only affects the auto-fit path — a no-op once `priceRangeOverride` is
   * set, at which point `scalePriceRange` takes over. */
  scalePrice(factor: number): void {
    this.priceScaleFactor = clamp(this.priceScaleFactor * factor, MIN_PRICE_SCALE_FACTOR, MAX_PRICE_SCALE_FACTOR);
  }

  /** Switches the price axis to manual mode, pinned at `range`. Call once,
   * lazily, the first time the user drags vertically — see `CinderChart`. */
  setPriceRangeOverride(range: PriceRange): void {
    this.priceRangeOverride = range;
  }

  /** Shifts the manual price range by an absolute amount (same units as
   * price). No-op until `setPriceRangeOverride` has been called at least
   * once — there is nothing to shift relative to otherwise. */
  panPriceRange(deltaAbsolute: number): void {
    if (!this.priceRangeOverride) return;
    this.priceRangeOverride = {
      min: this.priceRangeOverride.min + deltaAbsolute,
      max: this.priceRangeOverride.max + deltaAbsolute,
    };
  }

  /** Scales the manual price range around its own center. No-op until
   * `setPriceRangeOverride` has been called at least once. */
  scalePriceRange(factor: number): void {
    if (!this.priceRangeOverride) return;
    const { min, max } = this.priceRangeOverride;
    const mid = (min + max) / 2;
    const halfSpan = ((max - min) / 2) * factor;
    this.priceRangeOverride = { min: mid - halfSpan, max: mid + halfSpan };
  }
}
