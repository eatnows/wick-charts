import type { SeriesPoint } from '../types.js';

/**
 * What a plugin gets to draw with, rebuilt fresh by `ChartRenderer` every
 * frame from that frame's own geometry — a plugin never caches this across
 * renders, since panning/zooming changes every value here.
 *
 * Stronger than "don't cache it": `xForIndex` and `yForValue` must only be
 * called *synchronously*, inside the `draw()` call that received this
 * object. `yForValue` closes over the frame's `Scale`, which for a
 * large-enough series is WASM-backed and gets its backing memory freed the
 * moment `draw()` returns (see `ChartRenderer.render`'s `finally` block) —
 * stashing this object for a `setTimeout`, a promise callback, or the next
 * frame and calling `yForValue` from there is a use-after-free, not just a
 * staleness bug.
 */
export interface PluginRenderApi<TPoint extends SeriesPoint = SeriesPoint> {
  ctx: CanvasRenderingContext2D;
  chartWidth: number;
  chartHeight: number;
  /** Global (full sorted-array) index -> x pixel, same convention the
   * active series draws with. Valid only for the duration of this `draw()`
   * call — see the interface-level note on `PluginRenderApi`. */
  xForIndex: (globalIndex: number) => number;
  /** Value in the current frame's y-domain -> y pixel. Valid only for the
   * duration of this `draw()` call — see the interface-level note on
   * `PluginRenderApi`. */
  yForValue: (value: number) => number;
  /** x pixel -> global (possibly fractional) index — the exact inverse of
   * `xForIndex`, i.e. `xForIndex(indexForX(x)) === x`. For placing or
   * hit-testing something at a pixel position instead of a known index. */
  indexForX: (x: number) => number;
  /** y pixel -> value in the current frame's y-domain — the exact inverse
   * of `yForValue`. */
  valueForY: (y: number) => number;
  /** Index range currently visible, global (sorted-array) indices. */
  visibleStartIndex: number;
  visibleEndIndex: number;
  /**
   * Every point currently loaded (not just visible), sorted ascending by
   * time — the same array the active series slices its own `visible` from.
   * A plugin that needs data outside the visible window (a moving average
   * needs `period - 1` points of "warm-up" history before the first
   * visible bar to be accurate there) reads from here rather than being
   * limited to `visibleStartIndex..visibleEndIndex`.
   */
  allPoints: readonly TPoint[];
}

/**
 * A pointer (mouse, or single-finger touch) position, given to a plugin's
 * `onPointerDown`/`onPointerMove`/`onPointerUp`. `x`/`y` are canvas
 * backing-store pixels — the same convention `PluginRenderApi`'s
 * `xForIndex`/`yForValue` use. `index` and `value` are that position
 * already converted to data space (the chart's own inverse-coordinate
 * math, so a plugin never has to duplicate it): `index` is a possibly
 * fractional global (sorted-array) index, and `value` is the value under
 * the pointer in the current frame's y-domain — `null` if there's no data
 * or no usable chart area to compute one against.
 *
 * `xForIndex`/`yForValue` are the forward direction — for converting a
 * shape a plugin is storing in data space (so it survives pan/zoom) back
 * to pixels at the moment of this event, to compare against `x`/`y` with
 * `hitTestSegment`/`hitTestPoint` (see `src/hitTest.ts`). Same caveat as
 * `PluginRenderApi`'s mapping functions: valid for this dispatch only —
 * the mapping shifts on the next pan/zoom/frame, so call them
 * synchronously inside the handler that received this event, never stash
 * them for later.
 */
export interface ChartPointerEvent {
  x: number;
  y: number;
  index: number;
  value: number | null;
  xForIndex: (index: number) => number;
  yForValue: (value: number) => number | null;
}

/**
 * The extension point for anything that draws *on top of* a chart without
 * being the chart itself — price/event markers, alert lines, drawing
 * tools, annotations, indicator overlays. Register instances via
 * `WickChart.addPlugin`; `ChartRenderer` calls `draw` once per frame,
 * after the active series and axes, so plugin output always sits above the
 * plotted data.
 *
 * This is deliberately a single narrow interface rather than a family of
 * marker/annotation/tool base classes — a plugin author owns their own
 * styling and reads whatever data it needs (candle fields, indicator
 * state, ...) off `allPoints`, and just needs pixel-space geometry for the
 * current frame, which `PluginRenderApi` provides. Generic over the same
 * `TPoint` the chart itself is generic over, so a candlestick chart's
 * plugins see `Candle`-shaped points without a cast.
 *
 * The optional `onPointer*` hooks are what an *interactive* plugin (a
 * trend line, a drawing tool — anything placed or edited by the user,
 * rather than purely computed from data like an indicator) needs beyond
 * `draw`: a way to see raw pointer gestures on the chart, which
 * `WickChart` would otherwise consume entirely for its own panning.
 */
export interface ChartPlugin<TPoint extends SeriesPoint = SeriesPoint> {
  /**
   * Stable identifier for this plugin instance, opaque to the chart —
   * only used to look a plugin back up via `WickChart.setPluginVisible`
   * once an app is managing a growing list of indicators/drawing tools and
   * no longer wants to hold onto every instance it created. Not required:
   * a plugin with no `id` can still be added/removed by reference via
   * `addPlugin`/`removePlugin`, it just can't be targeted by
   * `setPluginVisible`. Uniqueness across the chart's plugins is the
   * caller's responsibility — the chart doesn't enforce it.
   */
  id?: string;
  /**
   * Whether this plugin currently draws and can claim pointer gestures.
   * Defaults to `true` (a plugin with no `visible` field behaves exactly
   * as before this field existed). Set to `false` to hide a plugin
   * without losing its state by removing it — e.g. an indicator or
   * drawing tool a user toggled off in a management UI but might turn
   * back on. Toggle it via `WickChart.setPluginVisible`, or mutate it
   * directly and call `chart.render()`.
   */
  visible?: boolean;
  /**
   * Routes this plugin's `draw()` into a specific pane instead of the main
   * price pane — the id must match one passed to `WickChart.addPane` (see
   * `PaneOptions.id` in `src/types.ts`). Omitted, or set to `'main'`,
   * keeps today's behavior: the plugin draws in the main price pane. A
   * `paneId` that doesn't match any currently-added pane is treated the
   * same as `'main'` (a plugin never silently stops drawing just because
   * its pane was removed before it was) — call `removePlugin` yourself if
   * that's not what you want when a pane goes away.
   */
  paneId?: string;
  draw(api: PluginRenderApi<TPoint>): void;
  /**
   * Called on pointer down inside the chart's plotting area (not the
   * price-axis strip). Return `true` to *claim* the gesture: `WickChart`
   * then suppresses its own panning/hover for this pointer until it's
   * released, and routes `onPointerMove`/`onPointerUp` to this plugin and
   * no other. Return `false`/`undefined` (the default, if omitted) to
   * leave the gesture to the chart's own panning — a plugin should only
   * claim a gesture while actively placing or editing something of its
   * own, not on every pointer down.
   *
   * Checked in reverse-registration order (the most recently added plugin
   * gets first refusal), and the first plugin to claim a gesture wins —
   * at most one plugin owns a given pointer down-to-up sequence.
   */
  onPointerDown?(event: ChartPointerEvent): boolean | void;
  /** Only called for a gesture this plugin's `onPointerDown` claimed. */
  onPointerMove?(event: ChartPointerEvent): void;
  /** Only called for a gesture this plugin's `onPointerDown` claimed. */
  onPointerUp?(event: ChartPointerEvent): void;
}
