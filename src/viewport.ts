import type { ValueRange } from './types.js';

const MIN_VISIBLE_COUNT = 5;
const MIN_VALUE_SCALE_FACTOR = 0.5;
const MAX_VALUE_SCALE_FACTOR = 8;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Pure pan/zoom/value-scale state — no DOM, no canvas. `CinderChart` owns
 * translating pixel deltas (drag distance, wheel delta) into calls here;
 * this class only owns the resulting numbers, which keeps it unit-testable
 * without a canvas. Generic across series types: "value" here is whatever
 * the active `SeriesDefinition.getValueRange` returns for the y-axis —
 * price for candlesticks, but no different in kind for a future line or
 * bar series's own value domain.
 */
export class Viewport {
  startIndex: number;
  visibleCount: number;
  /** 1 = auto-fit value range. >1 widens it (the series looks
   * shorter/compressed). <1 narrows it (the series looks taller), clamped
   * so real data never clips off-screen. Sign of drag->factor mapping
   * lives in CinderChart, not here. */
  valueScaleFactor = 1;

  /** Manually-set value range from a vertical drag or value-axis scale.
   * `null` until the user first touches the value axis — while `null` the
   * renderer auto-fits (see `SeriesDefinition.getValueRange`) using
   * `valueScaleFactor` alone. Once set, auto-fit stops applying: the user
   * has taken explicit control of the axis, so the chart stops
   * recentering it under them. */
  valueRangeOverride: ValueRange | null = null;

  constructor(totalCount: number, visibleCount?: number) {
    this.visibleCount = clamp(visibleCount ?? totalCount, MIN_VISIBLE_COUNT, Math.max(totalCount, MIN_VISIBLE_COUNT));
    this.startIndex = clamp(totalCount - this.visibleCount, 0, Math.max(0, totalCount - this.visibleCount));
  }

  get endIndex(): number {
    return this.startIndex + this.visibleCount;
  }

  /** Shifts the visible window. Positive `deltaPoints` moves forward in
   * time (later points come into view on the right). Clamped so the
   * window never leaves [0, totalCount] — no overscroll past the data. */
  pan(deltaPoints: number, totalCount: number): void {
    const maxStart = Math.max(0, totalCount - this.visibleCount);
    this.startIndex = clamp(this.startIndex + deltaPoints, 0, maxStart);
  }

  /** Scales the visible window by `factor` (>1 zooms out, <1 zooms in),
   * keeping the point at `anchorIndex` under the same relative position —
   * the standard "zoom toward the cursor" feel. */
  zoom(factor: number, anchorIndex: number, totalCount: number): void {
    const newVisibleCount = clamp(this.visibleCount * factor, MIN_VISIBLE_COUNT, totalCount);
    const anchorRatio = this.visibleCount === 0 ? 0.5 : (anchorIndex - this.startIndex) / this.visibleCount;

    this.visibleCount = newVisibleCount;
    const maxStart = Math.max(0, totalCount - this.visibleCount);
    this.startIndex = clamp(anchorIndex - anchorRatio * newVisibleCount, 0, maxStart);
  }

  /** Multiplies the value-scale factor, clamped to a sane range so the
   * value axis can't be dragged into showing nothing or clipping data.
   * Only affects the auto-fit path — a no-op once `valueRangeOverride` is
   * set, at which point `scaleValueRange` takes over. */
  scaleValue(factor: number): void {
    this.valueScaleFactor = clamp(this.valueScaleFactor * factor, MIN_VALUE_SCALE_FACTOR, MAX_VALUE_SCALE_FACTOR);
  }

  /** Switches the value axis to manual mode, pinned at `range`. Call once,
   * lazily, the first time the user drags vertically — see `CinderChart`. */
  setValueRangeOverride(range: ValueRange): void {
    this.valueRangeOverride = range;
  }

  /** Shifts the manual value range by an absolute amount (same units as
   * the plotted value). No-op until `setValueRangeOverride` has been
   * called at least once — there is nothing to shift relative to
   * otherwise. */
  panValueRange(deltaAbsolute: number): void {
    if (!this.valueRangeOverride) return;
    this.valueRangeOverride = {
      min: this.valueRangeOverride.min + deltaAbsolute,
      max: this.valueRangeOverride.max + deltaAbsolute,
    };
  }

  /** Scales the manual value range around its own center. No-op until
   * `setValueRangeOverride` has been called at least once. */
  scaleValueRange(factor: number): void {
    if (!this.valueRangeOverride) return;
    const { min, max } = this.valueRangeOverride;
    const mid = (min + max) / 2;
    const halfSpan = ((max - min) / 2) * factor;
    this.valueRangeOverride = { min: mid - halfSpan, max: mid + halfSpan };
  }
}
