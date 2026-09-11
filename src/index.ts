import type { DataLoader } from './dataSource.js';
import { mergeCandles } from './mergeCandles.js';
import { autoFitPriceRange } from './priceRange.js';
import { CandleRenderer } from './renderer.js';
import { toUnixSeconds } from './time.js';
import { Viewport } from './viewport.js';
import { loadWasm } from './wasm.js';
import { importRealWasm } from './wasmImporter.js';
import type { Candle, CinderChartOptions } from './types.js';

export type { BusinessDay, Candle, CinderChartOptions, CinderTime, UnixMillis } from './types.js';
export type { DataLoader, DataRequest } from './dataSource.js';
export type { Scale } from './hybridScale.js';
export { mergeCandles } from './mergeCandles.js';
export { LinearScale } from './scale.js';
export { toUnixSeconds } from './time.js';
export { Viewport } from './viewport.js';
export { getCachedWasmModule, loadWasm } from './wasm.js';

type DragMode = 'pan' | 'price-scale' | null;
type LoadDirection = 'before' | 'after';

/** How many candles are visible by default when `setData` is called without
 * an explicit window — opens on a recent slice rather than the entire
 * series zoomed all the way out, which would leave no room to pan. */
const DEFAULT_VISIBLE_CANDLES = 120;

/** How close (in candles) the visible window has to get to either edge of
 * the loaded data before `setDataLoader`'s loader is asked for more. */
const DEFAULT_LOAD_THRESHOLD = 20;

/**
 * Interactive candlestick chart: drag to pan, wheel to zoom, drag the
 * price-axis strip to rescale it, hover a candle for an OHLC legend.
 * Construct once per canvas; call `destroy()` when done with it (unmount)
 * to remove the window-level mouseup listener.
 */
export class CinderChart {
  private renderer: CandleRenderer;
  private sorted: Candle[] = [];
  private times: number[] = [];
  private viewport: Viewport;
  private hoverIndex: number | null = null;

  private dragMode: DragMode = null;
  private lastX = 0;
  private lastY = 0;
  private renderScheduled = false;
  /** Distance (CSS px) between two touches on the previous touchmove —
   * `null` whenever fewer than two fingers are down. Compared frame to
   * frame (not against a fixed start value) so it composes naturally with
   * the same incremental-delta style `applyPanDelta`/`applyPriceScaleDelta`
   * already use. */
  private pinchLastDistance: number | null = null;

  private loader: DataLoader | null = null;
  private loadThreshold = DEFAULT_LOAD_THRESHOLD;
  private loading: Record<LoadDirection, boolean> = { before: false, after: false };
  /** Set once a loader for a direction returns empty — stops re-asking at
   * every threshold crossing until `setData` resets it (a fresh dataset
   * may come from a different source that does have more). */
  private exhausted: Record<LoadDirection, boolean> = { before: false, after: false };

  constructor(
    private canvas: HTMLCanvasElement,
    options?: CinderChartOptions,
  ) {
    this.renderer = new CandleRenderer(canvas, options);
    this.viewport = new Viewport(0);
    // Without this, a touch drag on the canvas also scrolls/zooms the page
    // underneath it — the browser's native touch gestures and this class's
    // own pan/pinch handling would otherwise fight over the same gesture.
    canvas.style.touchAction = 'none';
    this.attachEvents();
    // Kicked off once per chart instance, not awaited — the renderer reads
    // whatever's cached synchronously (see hybridScale.ts) and just keeps
    // using the JS fallback for every render before this resolves.
    void loadWasm(importRealWasm);
  }

  setData(candles: Candle[]): this {
    this.sorted = [...candles].sort((a, b) => toUnixSeconds(a.time) - toUnixSeconds(b.time));
    this.times = this.sorted.map((c) => toUnixSeconds(c.time));
    this.viewport = new Viewport(this.sorted.length, DEFAULT_VISIBLE_CANDLES);
    this.hoverIndex = null;
    this.exhausted = { before: false, after: false };
    return this;
  }

  /**
   * Registers a callback the chart asks for more candles when the visible
   * window gets within `threshold` candles of either edge of what's
   * currently loaded. The chart never fetches on its own — it only decides
   * *when* more data is needed and merges what the loader returns; the
   * loader owns *how* (REST call, cache, websocket replay, whatever).
   */
  setDataLoader(loader: DataLoader, threshold: number = DEFAULT_LOAD_THRESHOLD): this {
    this.loader = loader;
    this.loadThreshold = threshold;
    return this;
  }

  render(): void {
    this.renderer.render({
      sorted: this.sorted,
      times: this.times,
      viewport: this.viewport,
      hoverIndex: this.hoverIndex,
    });
    this.maybeLoadMore();
  }

  /** Coalesces render() calls into at most one per animation frame. Mouse
   * events (drag, wheel) can fire far faster than the display refreshes —
   * calling render() directly from each one redraws the full canvas once
   * per event instead of once per frame, which is what actually causes
   * dragging to feel janky, not anything data-loading does. */
  private scheduleRender(): void {
    if (this.renderScheduled) return;
    this.renderScheduled = true;
    requestAnimationFrame(() => {
      this.renderScheduled = false;
      this.render();
    });
  }

  /** How many candles are currently loaded (not just visible) — grows as
   * `setDataLoader`'s loader supplies more history. */
  getCandleCount(): number {
    return this.sorted.length;
  }

  /** The currently visible window, in candle indices into the full loaded
   * series. Useful for building UI around the chart (a minimap, a "jump to
   * latest" button) without reaching into private state. */
  getVisibleRange(): { startIndex: number; endIndex: number; visibleCount: number } {
    return {
      startIndex: this.viewport.startIndex,
      endIndex: this.viewport.endIndex,
      visibleCount: this.viewport.visibleCount,
    };
  }

  /** The price axis's manual range once the user has dragged or scaled it
   * — `null` if the axis is still auto-fitting to whatever's visible
   * (the default until the user first touches it vertically). */
  getPriceRangeOverride(): { min: number; max: number } | null {
    return this.viewport.priceRangeOverride;
  }

  /** The candle currently under the cursor (crosshair/legend target), or
   * `null` when nothing is hovered. */
  getHoveredCandle(): Candle | null {
    return this.hoverIndex === null ? null : (this.sorted[this.hoverIndex] ?? null);
  }

  /** Removes all attached listeners. Call on unmount — the mouseup
   * listener is on `window` (so drags don't get stuck if the cursor
   * leaves the canvas mid-drag) and won't be garbage-collected on its own. */
  destroy(): void {
    const { canvas } = this;
    canvas.removeEventListener('mousedown', this.onMouseDown);
    canvas.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('mouseup', this.onMouseUp);
    canvas.removeEventListener('mouseleave', this.onMouseLeave);
    canvas.removeEventListener('wheel', this.onWheel);
    canvas.removeEventListener('touchstart', this.onTouchStart);
    canvas.removeEventListener('touchmove', this.onTouchMove);
    canvas.removeEventListener('touchend', this.onTouchEnd);
    canvas.removeEventListener('touchcancel', this.onTouchEnd);
  }

  private attachEvents(): void {
    const { canvas } = this;
    canvas.addEventListener('mousedown', this.onMouseDown);
    canvas.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mouseup', this.onMouseUp);
    canvas.addEventListener('mouseleave', this.onMouseLeave);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    // touchstart/touchmove must be non-passive since they call
    // preventDefault() to stop the page from scrolling under the drag.
    canvas.addEventListener('touchstart', this.onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', this.onTouchMove, { passive: false });
    canvas.addEventListener('touchend', this.onTouchEnd);
    canvas.addEventListener('touchcancel', this.onTouchEnd);
  }

  private onMouseDown = (e: MouseEvent): void => {
    const { x } = this.cursorPosition(e);
    this.dragMode = x >= this.renderer.chartWidth ? 'price-scale' : 'pan';
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    // Any drag that can touch the price axis (main-pane vertical pan or the
    // price-axis-strip scale drag) switches the axis to manual mode first,
    // seeded from whatever is on screen right now — otherwise there's no
    // "current range" to shift or scale relative to.
    this.ensurePriceRangeOverride();
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (this.dragMode === 'pan') {
      this.applyPanDelta(e.clientX, e.clientY);
      return;
    }
    if (this.dragMode === 'price-scale') {
      this.applyPriceScaleDelta(e.clientY);
      return;
    }
    this.updateHover(e);
  };

  private onMouseUp = (): void => {
    this.dragMode = null;
  };

  private onMouseLeave = (): void => {
    this.dragMode = null;
    if (this.hoverIndex !== null) {
      this.hoverIndex = null;
      this.scheduleRender();
    }
  };

  /** Shared by both mouse drag and single-finger touch drag: shifts the
   * visible time window and, once the price axis is in manual mode, the
   * visible price window too — see the "pan" branch `onMouseMove` used to
   * inline before mouse and touch needed the exact same math. */
  private applyPanDelta(clientX: number, clientY: number): void {
    // Coordinates are in CSS pixels; chartWidth/chartHeight are in canvas
    // backing-store (device) pixels, which differ under devicePixelRatio
    // scaling — convert before dividing or drags feel sluggish/dead on
    // high-DPI screens.
    const deltaXCss = clientX - this.lastX;
    const deltaYCss = clientY - this.lastY;
    this.lastX = clientX;
    this.lastY = clientY;

    const deltaXDevice = deltaXCss * this.devicePixelScaleX();
    const slotWidth = this.renderer.chartWidth / this.viewport.visibleCount;
    if (slotWidth > 0) {
      // Dragging right pulls the timeline back into view — like sliding
      // paper under a fixed magnifier — so pixel delta and index delta
      // have opposite sign.
      this.viewport.pan(-deltaXDevice / slotWidth, this.sorted.length);
    }

    const chartHeight = this.renderer.chartHeight;
    if (chartHeight > 0 && this.viewport.priceRangeOverride) {
      const deltaYDevice = deltaYCss * this.devicePixelScaleY();
      const { min, max } = this.viewport.priceRangeOverride;
      const pricePerPixel = (max - min) / chartHeight;
      // Dragging down moves the visible price window down (content
      // follows the cursor), matching the horizontal drag's "grab and
      // slide" feel — see the pan call above for the mirrored X case.
      this.viewport.panPriceRange(deltaYDevice * pricePerPixel);
    }

    this.scheduleRender();
  }

  /** Shared by both mouse drag and single-finger touch drag on the
   * price-axis strip. */
  private applyPriceScaleDelta(clientY: number): void {
    const deltaY = clientY - this.lastY;
    this.lastY = clientY;
    // Dragging the price axis down widens the visible price range
    // (candles shrink); dragging up narrows it (candles grow).
    this.viewport.scalePriceRange(Math.pow(1.006, deltaY));
    this.scheduleRender();
  }

  private onTouchStart = (e: TouchEvent): void => {
    e.preventDefault();

    if (e.touches.length === 2) {
      // A second finger landing takes over from whatever single-finger
      // drag might have been in progress.
      this.dragMode = null;
      this.pinchLastDistance = this.touchDistance(e.touches[0]!, e.touches[1]!);
      return;
    }

    if (e.touches.length === 1) {
      const touch = e.touches[0]!;
      const { x } = this.cursorPosition(touch);
      this.dragMode = x >= this.renderer.chartWidth ? 'price-scale' : 'pan';
      this.lastX = touch.clientX;
      this.lastY = touch.clientY;
      this.ensurePriceRangeOverride();
    }
  };

  private onTouchMove = (e: TouchEvent): void => {
    e.preventDefault();

    if (e.touches.length === 2) {
      const [t0, t1] = [e.touches[0]!, e.touches[1]!];
      const distance = this.touchDistance(t0, t1);
      const slotWidth = this.renderer.chartWidth / this.viewport.visibleCount;

      if (this.pinchLastDistance !== null && slotWidth > 0) {
        const { x } = this.cursorPosition({
          clientX: (t0.clientX + t1.clientX) / 2,
          clientY: (t0.clientY + t1.clientY) / 2,
        });
        const anchorIndex = this.viewport.startIndex + x / slotWidth;
        // Fingers spreading apart (distance growing) zooms in, matching
        // the standard pinch-to-zoom direction — mirrors onWheel's
        // "scroll down = zoom out" the same way a trackpad pinch does.
        const factor = this.pinchLastDistance / distance;
        this.viewport.zoom(factor, anchorIndex, this.sorted.length);
        this.scheduleRender();
      }

      this.pinchLastDistance = distance;
      return;
    }

    if (e.touches.length === 1 && this.dragMode) {
      const touch = e.touches[0]!;
      if (this.dragMode === 'pan') {
        this.applyPanDelta(touch.clientX, touch.clientY);
      } else {
        this.applyPriceScaleDelta(touch.clientY);
      }
    }
  };

  private onTouchEnd = (e: TouchEvent): void => {
    if (e.touches.length < 2) this.pinchLastDistance = null;
    if (e.touches.length === 0) this.dragMode = null;
  };

  private touchDistance(a: Touch, b: Touch): number {
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  }

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const slotWidth = this.renderer.chartWidth / this.viewport.visibleCount;
    if (slotWidth <= 0) return;

    // Trackpad horizontal swipes (and shift+wheel) report mostly on deltaX;
    // vertical wheel/scroll reports on deltaY. Whichever dominates decides
    // pan vs zoom — a horizontal-leaning gesture should never zoom.
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      const deltaXDevice = e.deltaX * this.devicePixelScaleX();
      this.viewport.pan(deltaXDevice / slotWidth, this.sorted.length);
      this.scheduleRender();
      return;
    }

    const { x } = this.cursorPosition(e);
    const anchorIndex = this.viewport.startIndex + x / slotWidth;
    const factor = e.deltaY > 0 ? 1.1 : 1 / 1.1; // scroll down = zoom out
    this.viewport.zoom(factor, anchorIndex, this.sorted.length);
    this.scheduleRender();
  };

  private updateHover(e: MouseEvent): void {
    const { x } = this.cursorPosition(e);
    if (x >= this.renderer.chartWidth || this.sorted.length === 0) {
      if (this.hoverIndex !== null) {
        this.hoverIndex = null;
        this.scheduleRender();
      }
      return;
    }

    const slotWidth = this.renderer.chartWidth / this.viewport.visibleCount;
    if (slotWidth <= 0) return;

    const rawIndex = Math.floor(this.viewport.startIndex + x / slotWidth);
    const nextHover = Math.min(this.sorted.length - 1, Math.max(0, rawIndex));

    if (nextHover !== this.hoverIndex) {
      this.hoverIndex = nextHover;
      this.scheduleRender();
    }
  }

  /** Checks whether the visible window is close enough to either edge of
   * the loaded data to ask `this.loader` for more. Safe to call after
   * every render — guarded so it never fires two overlapping requests for
   * the same direction or re-asks a direction that already came back
   * empty. */
  private maybeLoadMore(): void {
    if (!this.loader || this.sorted.length === 0) return;

    if (!this.loading.before && !this.exhausted.before && this.viewport.startIndex < this.loadThreshold) {
      this.requestMore('before', this.times[0]!);
    }

    const remainingAfter = this.sorted.length - this.viewport.endIndex;
    if (!this.loading.after && !this.exhausted.after && remainingAfter < this.loadThreshold) {
      this.requestMore('after', this.times[this.times.length - 1]!);
    }
  }

  private requestMore(direction: LoadDirection, boundary: number): void {
    const loader = this.loader;
    if (!loader) return;

    this.loading[direction] = true;
    Promise.resolve(loader({ direction, boundary, count: this.loadThreshold * 2 }))
      .then((newCandles) => this.applyLoadedCandles(direction, newCandles))
      .catch(() => {
        // A failed fetch just means we try again next time the viewport
        // re-crosses the threshold — not `exhausted`, since the data may
        // well exist and the next attempt could succeed.
      })
      .finally(() => {
        this.loading[direction] = false;
      });
  }

  private applyLoadedCandles(direction: LoadDirection, newCandles: Candle[]): void {
    if (newCandles.length === 0) {
      this.exhausted[direction] = true;
      return;
    }

    const previousCount = this.sorted.length;
    this.sorted = mergeCandles(this.sorted, newCandles);
    this.times = this.sorted.map((c) => toUnixSeconds(c.time));

    if (direction === 'before') {
      // Every candle prepended shifts every existing index forward by the
      // same amount — without this the visible window would visually jump
      // to show older data instead of staying put once the fetch lands.
      const prepended = this.sorted.length - previousCount;
      this.viewport.startIndex += prepended;
    }

    this.render();
  }

  /** Switches the price axis to manual mode if it hasn't been already,
   * seeding it from the current auto-fit range so the first pixel of a
   * drag doesn't jump. No-op on subsequent calls (already manual). */
  private ensurePriceRangeOverride(): void {
    if (this.viewport.priceRangeOverride || this.sorted.length === 0) return;
    const startIdx = Math.max(0, Math.floor(this.viewport.startIndex));
    const endIdx = Math.min(this.sorted.length, Math.ceil(this.viewport.endIndex));
    const visible = this.sorted.slice(startIdx, endIdx);
    if (visible.length === 0) return;
    this.viewport.setPriceRangeOverride(autoFitPriceRange(visible, this.viewport.priceScaleFactor));
  }

  /** Position in canvas backing-store pixels, accounting for the gap
   * between the canvas's CSS display size and its drawing-buffer size
   * (e.g. when the canvas width attribute is device-pixel-ratio scaled).
   * Takes any `{clientX, clientY}` point rather than `MouseEvent`
   * specifically, since a `Touch` (or a synthesized pinch midpoint) has
   * the same two fields and needs the exact same conversion. */
  private cursorPosition(point: { clientX: number; clientY: number }): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (point.clientX - rect.left) * this.devicePixelScaleX(),
      y: (point.clientY - rect.top) * this.devicePixelScaleY(),
    };
  }

  /** CSS-pixel-to-backing-store-pixel ratio for the X axis — same
   * conversion `cursorPosition` applies to absolute coordinates, extracted
   * so pixel *deltas* (drag distance, wheel deltaX) can be converted too. */
  private devicePixelScaleX(): number {
    const rect = this.canvas.getBoundingClientRect();
    return rect.width === 0 ? 1 : this.canvas.width / rect.width;
  }

  private devicePixelScaleY(): number {
    const rect = this.canvas.getBoundingClientRect();
    return rect.height === 0 ? 1 : this.canvas.height / rect.height;
  }
}
