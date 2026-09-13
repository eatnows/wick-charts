import type { DataLoader } from './dataSource.js';
import { mergeSeriesPoints } from './mergeSeries.js';
import { computePaneLayout } from './paneLayout.js';
import { ChartRenderer } from './renderer.js';
import { getSeries } from './series/registry.js';
import { toUnixSeconds } from './time.js';
import { Viewport } from './viewport.js';
import { loadWasm } from './wasm.js';
import { importRealWasm } from './wasmImporter.js';
import type { ChartPlugin, ChartPointerEvent } from './plugins/types.js';
import type { CandlestickStyle } from './series/candlestick.js';
import type { LineStyle } from './series/line.js';
import type { SeriesDefinition } from './series/types.js';
import type {
  Candle,
  LinePoint,
  PaneOptions,
  ResolvedPaneOptions,
  WickChartOptions,
  SeriesPoint,
  ValueRange,
} from './types.js';

export type {
  BusinessDay,
  Candle,
  LinePoint,
  PaneOptions,
  WickChartOptions,
  WickTime,
  SeriesPoint,
  UnixMillis,
  ValueRange,
} from './types.js';
export type { DataLoader, DataRequest } from './dataSource.js';
export type { ChartPlugin, ChartPointerEvent, PluginRenderApi } from './plugins/types.js';
export { distanceToSegment, hitTestPoint, hitTestSegment } from './hitTest.js';
export type { Scale } from './hybridScale.js';
export { mergeSeriesPoints } from './mergeSeries.js';
export { registerSeries, getSeries } from './series/registry.js';
export type { SeriesDefinition, SeriesDrawContext } from './series/types.js';
export type { CandlestickStyle } from './series/candlestick.js';
export type { LineStyle } from './series/line.js';
// Also registers 'candlestick'/'line' as a module-load side effect — see
// src/series/candlestick.ts, src/series/line.ts, and src/series/registry.ts.
// A new series type gets the same treatment: implement SeriesDefinition,
// export it here (or have the consuming app import it directly before
// constructing a chart of that type), and `type: '<its key>'` becomes
// usable with no other change to this file.
export { candlestickSeries } from './series/candlestick.js';
export { lineSeries } from './series/line.js';
export { LinearScale } from './scale.js';
export { toUnixSeconds } from './time.js';
export { Viewport } from './viewport.js';
export { getCachedWasmModule, loadWasm } from './wasm.js';

type DragMode = 'pan' | 'value-scale' | 'scrub' | null;
type LoadDirection = 'before' | 'after';

/** How many points are visible by default when `setData` is called without
 * an explicit window — opens on a recent slice rather than the entire
 * series zoomed all the way out, which would leave no room to pan. */
const DEFAULT_VISIBLE_POINTS = 120;

/** How close (in points) the visible window has to get to either edge of
 * the loaded data before `setDataLoader`'s loader is asked for more. */
const DEFAULT_LOAD_THRESHOLD = 20;

/** `PaneOptions.heightRatio`'s default — see `addPane`. */
const DEFAULT_PANE_HEIGHT_RATIO = 0.25;

/** `PaneOptions.getValueRange`'s default — see `addPane`. Fixed at
 * `[0, 1]` rather than auto-fitting to anything, since the pane has no
 * data of its own to fit to: only a plugin drawing into it knows what
 * range makes sense, which is exactly why `getValueRange` exists to be
 * overridden. */
const DEFAULT_PANE_VALUE_RANGE: ValueRange = { min: 0, max: 1 };

/** How long a single finger has to stay down before a still-in-progress
 * 'pan' touch switches to 'scrub' mode (touch has no hover, so this is its
 * substitute — hold to inspect a point instead of panning past it). */
const LONG_PRESS_MS = 350;

/** A finger moving more than this many CSS px from where it landed counts
 * as a real drag, not a hold — cancels the pending long-press timer so a
 * fast pan gesture never flips into scrub mid-motion. */
const LONG_PRESS_MOVE_TOLERANCE_PX = 10;

/**
 * Interactive chart: drag to pan, wheel to zoom, drag the price-axis strip
 * to rescale it, hover a point for a legend. What gets plotted (candles
 * today; a future line/area/bar series) is decided entirely by
 * `options.type` and the `SeriesDefinition` registered under it — this
 * class only owns generic engine concerns (viewport math, mouse/touch/wheel
 * handling, on-demand data loading, render scheduling) and never touches a
 * point's fields directly. Construct once per canvas; call `destroy()`
 * when done with it (unmount) to remove the window-level mouseup listener.
 */
export class WickChart<TPoint extends SeriesPoint = Candle> {
  private renderer: ChartRenderer<TPoint>;
  private seriesDefinition: SeriesDefinition<TPoint, unknown>;
  private sorted: TPoint[] = [];
  private times: number[] = [];
  private viewport: Viewport;
  private hoverIndex: number | null = null;
  /** Device-pixel y of the pointer/finger that produced `hoverIndex` — the
   * crosshair's horizontal line follows this directly, not any property of
   * the hovered point itself (see `ChartRenderer.renderCrosshairAndLegend`
   * for why: pinning it to, say, the candle's close would leave the line
   * motionless while the pointer moves within that candle's column). */
  private hoverY: number | null = null;
  private plugins: ChartPlugin<TPoint>[] = [];
  /** Indicator/oscillator panes declared via `addPane`, defaults already
   * resolved — see `ResolvedPaneOptions`. Empty until an app adds one; a
   * chart that never calls `addPane` renders exactly as it did before
   * panes existed (single price pane filling the whole plotting height). */
  private panes: ResolvedPaneOptions[] = [];
  /** The plugin whose `onPointerDown` returned `true` for the pointer
   * currently down, or `null` when no plugin has claimed the current
   * gesture (the common case — the chart handles it itself). */
  private activeGesturePlugin: ChartPlugin<TPoint> | null = null;

  private dragMode: DragMode = null;
  private lastX = 0;
  private lastY = 0;
  private renderScheduled = false;
  private pendingAnimationFrame: number | null = null;
  /** Distance (CSS px) between two touches on the previous touchmove —
   * `null` whenever fewer than two fingers are down. Compared frame to
   * frame (not against a fixed start value) so it composes naturally with
   * the same incremental-delta style `applyPanDelta`/`applyValueScaleDelta`
   * already use. */
  private pinchLastDistance: number | null = null;
  /** Where the current single-finger touch landed — compared against the
   * live position to tell a hold from a drag; see LONG_PRESS_MOVE_TOLERANCE_PX. */
  private touchStartX = 0;
  private touchStartY = 0;
  private longPressTimer: ReturnType<typeof setTimeout> | null = null;

  private loader: DataLoader<TPoint> | null = null;
  private loadThreshold = DEFAULT_LOAD_THRESHOLD;
  private loading: Record<LoadDirection, boolean> = { before: false, after: false };
  /** Set once a loader for a direction returns empty — stops re-asking at
   * every threshold crossing until `setData` resets it (a fresh dataset
   * may come from a different source that does have more). */
  private exhausted: Record<LoadDirection, boolean> = { before: false, after: false };

  constructor(
    private canvas: HTMLCanvasElement,
    options?: WickChartOptions,
  ) {
    this.seriesDefinition = getSeries<TPoint, unknown>(options?.type ?? 'candlestick');
    this.renderer = new ChartRenderer(canvas, this.seriesDefinition, options);
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

  setData(points: TPoint[]): this {
    this.sorted = [...points].sort((a, b) => toUnixSeconds(a.time) - toUnixSeconds(b.time));
    this.times = this.sorted.map((p) => toUnixSeconds(p.time));
    this.viewport = new Viewport(this.sorted.length, DEFAULT_VISIBLE_POINTS);
    this.hoverIndex = null;
    this.hoverY = null;
    this.exhausted = { before: false, after: false };
    return this;
  }

  /**
   * Registers a callback the chart asks for more points when the visible
   * window gets within `threshold` points of either edge of what's
   * currently loaded. The chart never fetches on its own — it only decides
   * *when* more data is needed and merges what the loader returns; the
   * loader owns *how* (REST call, cache, websocket replay, whatever).
   */
  setDataLoader(loader: DataLoader<TPoint>, threshold: number = DEFAULT_LOAD_THRESHOLD): this {
    this.loader = loader;
    this.loadThreshold = threshold;
    return this;
  }

  /** Registers a plugin (marker, annotation, drawing tool, ...) drawn on
   * top of the chart every frame after the series and axes — see
   * `src/plugins/types.ts`. Adding overlay features this way, rather than
   * by extending `WickChart` itself, is what keeps the core closed to
   * modification: a marker implementation never needs to touch this file. */
  addPlugin(plugin: ChartPlugin<TPoint>): this {
    this.plugins.push(plugin);
    this.scheduleRender();
    return this;
  }

  removePlugin(plugin: ChartPlugin<TPoint>): this {
    this.plugins = this.plugins.filter((p) => p !== plugin);
    this.scheduleRender();
    return this;
  }

  /** Every currently-registered plugin, in registration order — for an app
   * building a management UI (a list of attached indicators/drawing tools
   * with visibility toggles or delete buttons) without maintaining its own
   * parallel bookkeeping of every `addPlugin` call. A copy, not a live
   * view: mutating the returned array doesn't affect the chart. */
  getPlugins(): readonly ChartPlugin<TPoint>[] {
    return [...this.plugins];
  }

  /** Shows or hides every plugin whose `id` matches (see `ChartPlugin.id`)
   * and re-renders. A no-op, not an error, if nothing matches — plugins
   * with no `id` set are never matched. */
  setPluginVisible(id: string, visible: boolean): this {
    for (const plugin of this.plugins) {
      if (plugin.id === id) plugin.visible = visible;
    }
    this.scheduleRender();
    return this;
  }

  /**
   * Reserves a horizontal strip below the main price pane (and below any
   * previously-added pane — panes stack in call order) for an indicator or
   * oscillator, drawn entirely by `ChartPlugin`s registered with a
   * matching `paneId` (see `ChartPlugin.paneId`). The pane itself computes
   * nothing: `options.getValueRange` supplies whatever value-axis domain
   * makes sense for what will be plotted into it (a fixed `[0, 100]` for
   * RSI, an auto-fit range closed over a MACD series a plugin already
   * tracks, ...) — the same "core provides layout, the app provides the
   * math" split `addPlugin` already uses for indicator overlays on the
   * main pane. A no-op on layout until at least one plugin actually
   * targets this pane's `id`; an empty pane still reserves its space and
   * draws its own axis, just with nothing inside it.
   */
  addPane(options: PaneOptions): this {
    this.panes.push({
      id: options.id,
      heightRatio: options.heightRatio ?? DEFAULT_PANE_HEIGHT_RATIO,
      getValueRange: options.getValueRange ?? (() => DEFAULT_PANE_VALUE_RANGE),
    });
    this.scheduleRender();
    return this;
  }

  /** Removes a previously-added pane by `id` and re-renders. A no-op, not
   * an error, if nothing matches. Plugins still targeting the removed
   * pane's `id` via `ChartPlugin.paneId` fall back to drawing in the main
   * pane rather than being silently dropped — see the doc comment on
   * `ChartPlugin.paneId`. */
  removePane(id: string): this {
    this.panes = this.panes.filter((pane) => pane.id !== id);
    this.scheduleRender();
    return this;
  }

  /** Every currently-declared pane's `id` and resolved `heightRatio`, in
   * stacking order (top to bottom, main pane excluded since it always
   * exists and always sits first) — for an app building a management UI
   * around indicator panes without maintaining its own parallel list. */
  getPanes(): readonly { id: string; heightRatio: number }[] {
    return this.panes.map(({ id, heightRatio }) => ({ id, heightRatio }));
  }

  render(): void {
    this.renderer.render({
      sorted: this.sorted,
      times: this.times,
      viewport: this.viewport,
      hoverIndex: this.hoverIndex,
      hoverY: this.hoverY,
      plugins: this.plugins,
      panes: this.panes,
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
    this.pendingAnimationFrame = requestAnimationFrame(() => {
      this.renderScheduled = false;
      this.pendingAnimationFrame = null;
      this.render();
    });
  }

  /** How many points are currently loaded (not just visible) — grows as
   * `setDataLoader`'s loader supplies more history. */
  getPointCount(): number {
    return this.sorted.length;
  }

  /** The currently visible window, in point indices into the full loaded
   * series. Useful for building UI around the chart (a minimap, a "jump to
   * latest" button) without reaching into private state. */
  getVisibleRange(): { startIndex: number; endIndex: number; visibleCount: number } {
    return {
      startIndex: this.viewport.startIndex,
      endIndex: this.viewport.endIndex,
      visibleCount: this.viewport.visibleCount,
    };
  }

  /** The value axis's manual range once the user has dragged or scaled it
   * — `null` if the axis is still auto-fitting to whatever's visible
   * (the default until the user first touches it vertically). */
  getValueRangeOverride(): ValueRange | null {
    // A copy, not the live internal object — a caller mutating what they
    // got back should never be able to corrupt the viewport's own state.
    const range = this.viewport.valueRangeOverride;
    return range ? { ...range } : null;
  }

  /** The point currently under the cursor (crosshair/legend target), or
   * `null` when nothing is hovered. */
  getHoveredPoint(): TPoint | null {
    return this.hoverIndex === null ? null : (this.sorted[this.hoverIndex] ?? null);
  }

  /** Removes all attached listeners. Call on unmount — the mouseup
   * listener is on `window` (so drags don't get stuck if the cursor
   * leaves the canvas mid-drag) and won't be garbage-collected on its own. */
  destroy(): void {
    this.clearLongPressTimer();
    if (this.pendingAnimationFrame !== null) {
      cancelAnimationFrame(this.pendingAnimationFrame);
      this.pendingAnimationFrame = null;
    }
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
    const { x, y } = this.cursorPosition(e);
    if (x < this.renderer.chartWidth && this.dispatchPointerDown(x, y)) return;

    this.dragMode = x >= this.renderer.chartWidth ? 'value-scale' : 'pan';
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    // Any drag that can touch the price axis (main-pane vertical pan or the
    // price-axis-strip scale drag) switches the axis to manual mode first,
    // seeded from whatever is on screen right now — otherwise there's no
    // "current range" to shift or scale relative to.
    this.ensureValueRangeOverride();
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (this.activeGesturePlugin) {
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      const { x, y } = this.cursorPosition(e);
      this.activeGesturePlugin.onPointerMove?.(this.pointerEventAt(x, y));
      return;
    }
    if (this.dragMode === 'pan') {
      this.applyPanDelta(e.clientX, e.clientY);
      return;
    }
    if (this.dragMode === 'value-scale') {
      this.applyValueScaleDelta(e.clientY);
      return;
    }
    this.updateHover(e);
  };

  private onMouseUp = (e: MouseEvent): void => {
    if (this.activeGesturePlugin) {
      const { x, y } = this.cursorPosition(e);
      this.activeGesturePlugin.onPointerUp?.(this.pointerEventAt(x, y));
      this.activeGesturePlugin = null;
      this.scheduleRender();
      return;
    }
    this.dragMode = null;
  };

  private onMouseLeave = (): void => {
    this.dragMode = null;
    if (this.hoverIndex !== null) {
      this.hoverIndex = null;
      this.hoverY = null;
      this.scheduleRender();
    }
  };

  /** Shared by both mouse drag and single-finger touch drag: shifts the
   * visible time window and, once the value axis is in manual mode, the
   * visible value window too — see the "pan" branch `onMouseMove` used to
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

    const chartHeight = this.mainPaneHeight();
    if (chartHeight > 0 && this.viewport.valueRangeOverride) {
      const deltaYDevice = deltaYCss * this.devicePixelScaleY();
      const { min, max } = this.viewport.valueRangeOverride;
      const valuePerPixel = (max - min) / chartHeight;
      // Dragging down moves the visible value window down (content
      // follows the cursor), matching the horizontal drag's "grab and
      // slide" feel — see the pan call above for the mirrored X case.
      this.viewport.panValueRange(deltaYDevice * valuePerPixel);
    }

    this.scheduleRender();
  }

  /** Shared by both mouse drag and single-finger touch drag on the
   * price-axis strip. */
  private applyValueScaleDelta(clientY: number): void {
    const deltaY = clientY - this.lastY;
    this.lastY = clientY;
    // Dragging the price axis down widens the visible value range
    // (the series looks shorter); dragging up narrows it (looks taller).
    this.viewport.scaleValueRange(Math.pow(1.006, deltaY));
    this.scheduleRender();
  }

  private onTouchStart = (e: TouchEvent): void => {
    e.preventDefault();

    if (e.touches.length === 2) {
      // A second finger landing takes over from whatever single-finger
      // gesture might have been in progress — including a pending
      // long-press, an already-active scrub, or a plugin gesture, none of
      // which make sense once this becomes a pinch. Clearing the hover
      // here (not just relying on the eventual touchend) matters because
      // dragMode stops being 'scrub' the instant we set it to null two
      // lines down.
      this.clearLongPressTimer();
      if (this.activeGesturePlugin) {
        this.activeGesturePlugin.onPointerUp?.(this.pointerEventAtLast());
        this.activeGesturePlugin = null;
      }
      if (this.hoverIndex !== null) {
        this.hoverIndex = null;
        this.hoverY = null;
        this.scheduleRender();
      }
      this.dragMode = null;
      this.pinchLastDistance = this.touchDistance(e.touches[0]!, e.touches[1]!);
      return;
    }

    if (e.touches.length === 1) {
      const touch = e.touches[0]!;
      const { x, y } = this.cursorPosition(touch);
      this.lastX = touch.clientX;
      this.lastY = touch.clientY;
      if (x < this.renderer.chartWidth && this.dispatchPointerDown(x, y)) return;

      this.dragMode = x >= this.renderer.chartWidth ? 'value-scale' : 'pan';
      this.touchStartX = touch.clientX;
      this.touchStartY = touch.clientY;
      this.ensureValueRangeOverride();

      // Touch has no hover, so holding a finger still is its substitute:
      // if it's still a 'pan' candidate (not already moved into a real
      // drag, not on the price-axis strip) when this fires, switch to
      // inspecting the point under the finger instead of panning.
      if (this.dragMode === 'pan') {
        this.clearLongPressTimer();
        this.longPressTimer = setTimeout(() => {
          this.longPressTimer = null;
          if (this.dragMode === 'pan') {
            this.dragMode = 'scrub';
            this.updateHover({ clientX: this.lastX, clientY: this.lastY });
          }
        }, LONG_PRESS_MS);
      }
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

    if (e.touches.length !== 1) return;
    const touch = e.touches[0]!;

    if (this.activeGesturePlugin) {
      this.lastX = touch.clientX;
      this.lastY = touch.clientY;
      const { x, y } = this.cursorPosition(touch);
      this.activeGesturePlugin.onPointerMove?.(this.pointerEventAt(x, y));
      return;
    }

    if (this.dragMode === 'pan') {
      const movedDistance = Math.hypot(touch.clientX - this.touchStartX, touch.clientY - this.touchStartY);
      if (movedDistance > LONG_PRESS_MOVE_TOLERANCE_PX) {
        // A real drag, not a hold — the long-press timer (if still
        // pending) would otherwise fire mid-drag and yank control away
        // from panning.
        this.clearLongPressTimer();
      }
      this.applyPanDelta(touch.clientX, touch.clientY);
      return;
    }

    if (this.dragMode === 'value-scale') {
      this.applyValueScaleDelta(touch.clientY);
      return;
    }

    if (this.dragMode === 'scrub') {
      this.updateHover(touch);
    }
  };

  private onTouchEnd = (e: TouchEvent): void => {
    if (e.touches.length < 2) this.pinchLastDistance = null;
    if (e.touches.length === 0) {
      this.clearLongPressTimer();
      if (this.activeGesturePlugin) {
        // touchend's own .touches is already empty — the lifted finger's
        // last known position is whatever lastX/lastY was last set to (on
        // touchstart or the most recent touchmove), not anything on this event.
        this.activeGesturePlugin.onPointerUp?.(this.pointerEventAtLast());
        this.activeGesturePlugin = null;
        this.scheduleRender();
      }
      // Scrubbing has no persistent state after the finger lifts — unlike
      // a mouse, which can keep hovering the last position, a lifted
      // finger isn't "still pointing" at anything, so the legend/crosshair
      // should disappear rather than stay pinned to wherever it last was.
      // Unconditional on hoverIndex alone (not gated on dragMode === 'scrub')
      // so a hover left over from a scrub-then-pinch sequence still clears
      // here even though dragMode was already reset to null earlier.
      if (this.hoverIndex !== null) {
        this.hoverIndex = null;
        this.hoverY = null;
        this.scheduleRender();
      }
      this.dragMode = null;
    }
  };

  private clearLongPressTimer(): void {
    if (this.longPressTimer !== null) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
  }

  private touchDistance(a: Touch, b: Touch): number {
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  }

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    if (e.deltaX === 0 && e.deltaY === 0) return; // e.g. a momentum-scroll's trailing zero-delta event
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

  private updateHover(point: { clientX: number; clientY: number }): void {
    const { x, y } = this.cursorPosition(point);
    if (x >= this.renderer.chartWidth || this.sorted.length === 0) {
      if (this.hoverIndex !== null) {
        this.hoverIndex = null;
        this.hoverY = null;
        this.scheduleRender();
      }
      return;
    }

    const slotWidth = this.renderer.chartWidth / this.viewport.visibleCount;
    if (slotWidth <= 0) return;

    const rawIndex = Math.floor(this.viewport.startIndex + x / slotWidth);
    const nextHover = Math.min(this.sorted.length - 1, Math.max(0, rawIndex));

    // Re-render on *either* changing — not just a new candle column. The
    // crosshair's horizontal line tracks y continuously (see
    // ChartRenderer.renderCrosshairAndLegend), so without the y check here
    // it would only move when the pointer crosses into a different candle,
    // looking stuck the rest of the time.
    if (nextHover !== this.hoverIndex || y !== this.hoverY) {
      this.hoverIndex = nextHover;
      this.hoverY = y;
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
      .then((newPoints) => this.applyLoadedPoints(direction, newPoints))
      .catch(() => {
        // A failed fetch just means we try again next time the viewport
        // re-crosses the threshold — not `exhausted`, since the data may
        // well exist and the next attempt could succeed.
      })
      .finally(() => {
        this.loading[direction] = false;
      });
  }

  private applyLoadedPoints(direction: LoadDirection, newPoints: TPoint[]): void {
    if (newPoints.length === 0) {
      this.exhausted[direction] = true;
      return;
    }

    const previousCount = this.sorted.length;
    this.sorted = mergeSeriesPoints(this.sorted, newPoints);
    this.times = this.sorted.map((p) => toUnixSeconds(p.time));

    if (direction === 'before') {
      // Every point prepended shifts every existing index forward by the
      // same amount — without this the visible window would visually jump
      // to show older data instead of staying put once the fetch lands.
      const prepended = this.sorted.length - previousCount;
      this.viewport.startIndex += prepended;
    }

    this.render();
  }

  /** Switches the price/value axis to manual mode if it hasn't been
   * already, seeding it from the current auto-fit range so the first pixel
   * of a drag doesn't jump. No-op on subsequent calls (already manual). */
  private ensureValueRangeOverride(): void {
    if (this.viewport.valueRangeOverride) return;
    const range = this.frameValueRange();
    if (range) this.viewport.setValueRangeOverride(range);
  }

  /** The value range the *next* render would use — whatever's already
   * manually overridden, or a fresh auto-fit computed the same way
   * `ChartRenderer.render` does. Used outside of a render pass itself, by
   * anything that needs to convert a pixel position to a data value
   * on-demand (`valueForY`, dispatched pointer events) rather than only
   * during `render()`. `null` when there's nothing to compute one from. */
  private frameValueRange(): ValueRange | null {
    if (this.viewport.valueRangeOverride) return this.viewport.valueRangeOverride;
    if (this.sorted.length === 0) return null;
    const startIdx = Math.max(0, Math.floor(this.viewport.startIndex));
    const endIdx = Math.min(this.sorted.length, Math.ceil(this.viewport.endIndex));
    const visible = this.sorted.slice(startIdx, endIdx);
    if (visible.length === 0) return null;
    return this.seriesDefinition.getValueRange(visible, this.viewport.valueScaleFactor);
  }

  /** The main price pane's own pixel height for the *next* render — as
   * opposed to `this.renderer.chartHeight`, which is the whole pane
   * stack's height (main pane plus every declared indicator pane below
   * it). Every pixel<->value conversion outside of `ChartRenderer.render`
   * itself (price-axis drag-to-scale, `ChartPointerEvent.value`, ...) is
   * about the main pane specifically — pointer gestures and price-axis
   * dragging aren't pane-aware yet, so they only ever mean the main price
   * pane — and has to divide by this, not the full stack, or dragging
   * would run at the wrong speed (or a hovered value would come out
   * wrong) as soon as an app adds its first indicator pane. */
  private mainPaneHeight(): number {
    return computePaneLayout(this.panes, this.renderer.chartHeight).main.height;
  }

  /** y pixel -> value in the range the next render would use. `null` if
   * there's no data or no usable chart area to compute one against — see
   * `ChartPointerEvent.value`. */
  private valueForY(y: number): number | null {
    const range = this.frameValueRange();
    const chartHeight = this.mainPaneHeight();
    if (!range || chartHeight <= 0) return null;
    return range.min + (1 - y / chartHeight) * (range.max - range.min);
  }

  /** x pixel -> global (possibly fractional) index — the exact inverse of
   * the renderer's own `xForIndex`, so a pointer event lines up with
   * wherever the chart itself would draw that index. */
  private indexForX(x: number): number {
    const slotWidth = this.renderer.chartWidth / this.viewport.visibleCount;
    if (slotWidth <= 0) return this.viewport.startIndex;
    return this.viewport.startIndex + (x - slotWidth / 2) / slotWidth;
  }

  /** Global (possibly fractional) index -> x pixel — the exact inverse of
   * `indexForX` above, and the same formula `ChartRenderer.render` draws
   * with for the current viewport. Exposed on `ChartPointerEvent` so a
   * plugin can convert a shape it's storing in data space back to pixels
   * for hit-testing, without duplicating this math itself. */
  private xForIndex(index: number): number {
    const slotWidth = this.renderer.chartWidth / this.viewport.visibleCount;
    return (index - this.viewport.startIndex) * slotWidth + slotWidth / 2;
  }

  /** Value in the range the next render would use -> y pixel — the exact
   * inverse of `valueForY` above. `null` under the same conditions
   * `valueForY` returns `null` for. */
  private yForValue(value: number): number | null {
    const range = this.frameValueRange();
    const chartHeight = this.mainPaneHeight();
    if (!range || chartHeight <= 0) return null;
    return chartHeight * (1 - (value - range.min) / (range.max - range.min));
  }

  private pointerEventAt(x: number, y: number): ChartPointerEvent {
    return {
      x,
      y,
      index: this.indexForX(x),
      value: this.valueForY(y),
      xForIndex: (index) => this.xForIndex(index),
      yForValue: (value) => this.yForValue(value),
    };
  }

  /** Same as `pointerEventAt`, but starting from `lastX`/`lastY` (raw
   * `clientX`/`clientY`, tracked on every pointer move) instead of
   * already-converted chart-area pixels — for the two touch-end paths
   * where there's no current touch position to read coordinates from. */
  private pointerEventAtLast(): ChartPointerEvent {
    const { x, y } = this.cursorPosition({ clientX: this.lastX, clientY: this.lastY });
    return this.pointerEventAt(x, y);
  }

  /** Offers a pointer-down at `(x, y)` (chart-area pixels) to each plugin
   * in reverse-registration order, stopping at the first one whose
   * `onPointerDown` returns `true`. That plugin becomes
   * `activeGesturePlugin` for the rest of the gesture; returns whether
   * anyone claimed it, so callers know whether to skip their own default
   * pan/price-scale handling. */
  private dispatchPointerDown(x: number, y: number): boolean {
    const event = this.pointerEventAt(x, y);
    for (let i = this.plugins.length - 1; i >= 0; i--) {
      const plugin = this.plugins[i]!;
      if (plugin.visible === false) continue;
      if (plugin.onPointerDown?.(event)) {
        this.activeGesturePlugin = plugin;
        return true;
      }
    }
    return false;
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

/**
 * `new WickChart(canvas, { type: 'candlestick', style: {...} })` type-checks
 * even if `style` has nothing to do with `CandlestickStyle` — `type` is a
 * runtime string the registry resolves, so nothing ties it to a specific
 * `TStyle` at the type level (see `src/series/registry.ts`). This factory
 * pins both `TPoint` (`Candle`) and `TStyle` (`CandlestickStyle`) for the
 * one series built into the library, so `style` is fully checked here.
 *
 * A new series type gets the same treatment: export an equivalent
 * `create<Name>Chart` next to it (in your own module, or a file like this
 * one) rather than widening `WickChartOptions` itself — that keeps every
 * series's style shape independent of every other's.
 */
export function createCandlestickChart(
  canvas: HTMLCanvasElement,
  options?: Omit<WickChartOptions, 'type' | 'style'> & { style?: Partial<CandlestickStyle> },
): WickChart<Candle> {
  return new WickChart<Candle>(canvas, { ...options, type: 'candlestick' });
}

/**
 * The second series type's equivalent of `createCandlestickChart` above —
 * pins `TPoint` (`LinePoint`) and `TStyle` (`LineStyle`) so `style` is
 * fully checked here the same way, rather than accepted as the untyped
 * `Record<string, unknown>` `WickChartOptions.style` allows for `new
 * WickChart(canvas, { type: 'line', style })`.
 */
export function createLineChart(
  canvas: HTMLCanvasElement,
  options?: Omit<WickChartOptions, 'type' | 'style'> & { style?: Partial<LineStyle> },
): WickChart<LinePoint> {
  return new WickChart<LinePoint>(canvas, { ...options, type: 'line' });
}
