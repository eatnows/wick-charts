# cinder-charts

An open-source financial charting library. WASM (Rust) for compute, Canvas2D for rendering.

## Why

A serious trading UI needs more than a candlestick renderer on a page — drawing tools,
multi-pane indicator stacks, replay, and large-series performance all matter once real
usage starts. cinder-charts aims to cover that ground natively from the start, while keeping
rendering on the simplest thing that can possibly work (Canvas2D — no WebGL until profiling
says it's actually needed).

## Usage

Not published to npm yet — for now, clone this repo, build it, and import from its `dist/`
(either via a local path/workspace dependency, or by copying `dist/` and `wasm-pkg/` into your
own project, keeping them siblings — see "Install" below for why that layout matters).

### Install

```bash
git clone <this-repo> cinder-charts
cd cinder-charts
pnpm install
pnpm build:wasm   # requires the Rust toolchain + wasm-pack; produces wasm-pkg/
pnpm build        # produces dist/
```

`dist/` and `wasm-pkg/` must stay siblings (the compiled JS does `import('../wasm-pkg/...')`
relative to its own location). If you copy the library into another project rather than
depending on it in place, copy both directories together. This isn't a hard requirement,
though — a missing or unreachable `wasm-pkg/` is caught internally and the chart falls back to
the plain-JS scale for every frame (see "WASM" below), so a broken path degrades performance
silently rather than crashing.

### Quick start

```html
<canvas id="chart"></canvas>
```

```ts
import { createCandlestickChart } from 'cinder-charts';

const canvas = document.getElementById('chart') as HTMLCanvasElement;

// The canvas element's width/height attributes are its backing-store
// (pixel) size — independent of whatever size CSS displays it at. Set
// both explicitly (accounting for devicePixelRatio) before constructing
// the chart, and again on every resize.
function resizeCanvas() {
  const rect = canvas.parentElement!.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
}
resizeCanvas();

const chart = createCandlestickChart(canvas);

chart.setData([
  { time: '2024-01-01T00:00:00Z', open: 100, high: 105, low: 98, close: 103 },
  { time: '2024-01-02T00:00:00Z', open: 103, high: 110, low: 101, close: 108 },
  { time: '2024-01-03T00:00:00Z', open: 108, high: 109, low: 104, close: 106 },
  // ...
]);

chart.render();

window.addEventListener('resize', () => {
  resizeCanvas();
  chart.render(); // re-render at the new backing-store size
});
```

Panning, zooming, the price-axis drag, hover, and touch (single-finger pan, pinch-to-zoom,
long-press to scrub) all work immediately after `render()` — no further wiring needed; see
"Status" below for the full interaction list.

### Candle data

A candle is `{ time, open, high, low, close, volume? }`. `time` accepts several shapes so you
don't have to pre-convert whatever your data source hands you:

```ts
{ time: 1704067200 }                                  // unix seconds
{ time: { unixMs: 1704067200000 } }                   // unix milliseconds
{ time: '2024-01-01T00:00:00Z' }                       // ISO 8601 string
{ time: { businessDay: { year: 2024, month: 1, day: 1 } } } // calendar day, no time-of-day
```

`volume` is entirely optional and per-candle: include it and a translucent bar is drawn for
that candle in the bottom fifth of the chart, scaled against the largest volume currently in
view; omit it (on some candles, or on all of them) and nothing is drawn or reserved for
it — a dataset with no `volume` at all renders exactly as if the feature didn't exist.

`setData()` sorts by time itself, so passing data in any order (or re-calling it with a fresh
array) is safe. It resets pan/zoom/hover state — call it for a genuinely new dataset, and use
`setDataLoader()` (below) to extend the current one instead.

### Styling

Every visual aspect of the chart is an option — nothing is a fixed constant you can't reach.
They split into two groups: `style` is specific to the active series (candlestick's colors,
body width, volume bars); `background`/`font`/`axis`/`crosshair`/`legend` are engine-level,
shared by whatever series is active, and merged field by field over their own defaults so you
only need to specify what you're changing:

```ts
const chart = createCandlestickChart(canvas, {
  background: '#0d1117',
  style: {
    upColor: '#26a69a',
    downColor: '#ef5350',
    bodyWidthRatio: 0.6, // candle width as a fraction of its slot; the rest is gap
    volumeAreaHeightRatio: 0.2, // how much of the chart height volume bars occupy
    volumeBarOpacity: 0.5,
  },
  font: {
    family: 'sans-serif',
    axisSize: 10, // axis ticks + crosshair axis labels
    legendSize: 11, // the hover legend
  },
  axis: {
    priceWidth: 64, // width, in px, of the price-axis strip on the right
    timeHeight: 24, // height, in px, of the time-axis strip at the bottom
    priceTickCount: 5,
    timeMaxTicks: 6,
    textColor: '#787878',
    lineColor: '#33333333',
    gridLineColor: '#2a2a2a55',
  },
  crosshair: {
    lineColor: '#9090904d',
    labelBackground: '#3a3a3a',
    labelTextColor: '#f0f0f0',
    labelPaddingX: 4,
    labelPaddingY: 3,
  },
  legend: {
    textColor: '#f0f0f0', // the OHLC(+volume) hover tooltip's text
    background: '#3a3a3a', // the tooltip's background fill
    paddingX: 8, // horizontal padding inside the tooltip
    paddingY: 6, // vertical padding inside the tooltip
    cursorGap: 12, // gap, in px, between the hovered pixel and the tooltip
  },
});
```

Every value shown above is the built-in default — this example changes nothing; it's a
reference for what exists. The `legend` options style a small tooltip — one line per
`formatLegend()` part — that follows the hovered pixel like a speech bubble, offset up and to
the right of it, and clamped so it never runs off the chart's edges. `createCandlestickChart`
type-checks `style` against
`CandlestickStyle`; the more general `new CinderChart(canvas, { type: 'candlestick', style })`
also works but doesn't — see "Series types" below for why, if you're curious.

### Reading chart state

Useful for building UI around the canvas (a legend, a toolbar, a "jump to latest" button)
without reaching into the chart's internals:

```ts
chart.getPointCount();        // total candles loaded (not just visible)
chart.getVisibleRange();      // { startIndex, endIndex, visibleCount }
chart.getValueRangeOverride(); // { min, max } once the user has dragged the price axis, else null
chart.getHoveredPoint();      // the candle under the cursor/finger, or null
```

### Loading more history on demand

`setDataLoader` lets you start with a small window and stream in more as the user pans toward
either edge, without the library ever calling `fetch` itself:

```ts
chart.setDataLoader(async ({ direction, boundary, count }) => {
  // direction: 'before' (user panned toward older data) or 'after' (toward newer)
  // boundary: unix seconds — the earliest ('before') or latest ('after') time already loaded
  // count: how many candles would satisfy this request (a hint, not a hard requirement)
  const candles = await fetchCandlesFrom(direction, boundary, count);
  return candles; // an empty array tells the chart "no more data this way" until setData() resets it
}, /* threshold, in candles, default 20 */ 20);
```

### Extending: plugins

For overlays on top of the chart (markers, alert lines, annotations) that don't need to be a
whole chart type of their own:

```ts
chart.addPlugin({
  draw({ ctx, xForIndex, yForValue, visibleStartIndex, visibleEndIndex }) {
    const index = 42;
    if (index < visibleStartIndex || index >= visibleEndIndex) return;
    ctx.fillStyle = '#ffcc00';
    ctx.beginPath();
    ctx.arc(xForIndex(index), yForValue(150), 4, 0, Math.PI * 2);
    ctx.fill();
  },
});
```

Only call `xForIndex`/`yForValue` synchronously inside `draw()` — see "Plugins" below for why.
`removePlugin()` takes the same object back out. `allPoints` (the full loaded series, not
just what's visible) is there for exactly this kind of overlay: a moving average or any other
windowed calculation needs `period - 1` points of history *before* the visible window to be
accurate at its left edge. `demo/index.html` has a complete worked example (a moving average
built entirely in the demo's own code, period and color included) — see "Indicators" below
for why that lives in the demo and not in the library itself.

#### Interactive plugins: drawing tools

A plugin that only draws (a marker, an indicator overlay) never needs anything beyond `draw()`.
One that's placed or edited by the user — a trend line, a horizontal price alert someone drags
into position — needs to see raw pointer gestures too, which `CinderChart` would otherwise
consume entirely for its own panning. `onPointerDown`/`onPointerMove`/`onPointerUp` are for
exactly this:

```ts
let start = null;

chart.addPlugin({
  draw({ ctx, xForIndex, yForValue }) {
    if (!start) return;
    ctx.strokeStyle = '#00c2ff';
    ctx.beginPath();
    ctx.moveTo(xForIndex(start.index), yForValue(start.value));
    ctx.lineTo(xForIndex(start.end.index), yForValue(start.end.value));
    ctx.stroke();
  },
  onPointerDown(e) {
    if (e.value === null) return false; // nothing to anchor a line to
    start = { index: e.index, value: e.value, end: e };
    return true; // claim the gesture — the chart won't pan while this line is being drawn
  },
  onPointerMove(e) {
    start.end = e;
  },
  onPointerUp(e) {
    start.end = e; // the line is now finished; a real tool would push it into a list and stop editing
  },
});
```

`e.index`/`e.value` are the pointer position already converted to data space — a possibly
fractional index and the value under the cursor in the current frame's y-domain — computed
the exact same way `xForIndex`/`yForValue` map the other direction, so a line anchored at
`e.index`/`e.value` and drawn back through `xForIndex`/`yForValue` lines up with the pointer
exactly. This example always claims the gesture once a value exists, which is enough to prove
the mechanism but would fight with panning in a real app (every drag becomes a new line) — a
real drawing tool gates `onPointerDown` behind its own "tool active" state (a toggle button,
a keyboard modifier, whatever fits the app), only claiming gestures while armed.

#### Managing a growing list of plugins

An app with more than a couple of indicators/drawing tools attached usually wants a UI for
them — a panel listing what's currently on the chart, with a way to hide or remove each one —
rather than holding onto every instance it ever passed to `addPlugin` by hand. Give a plugin an
`id` and the chart can look it back up without the app tracking the object reference itself:

```ts
chart.addPlugin({ id: 'ma-20', draw(api) { /* ... */ } });
chart.addPlugin({ id: 'trend-1', draw(api) { /* ... */ }, onPointerDown, onPointerMove, onPointerUp });

chart.getPlugins(); // [{ id: 'ma-20', ... }, { id: 'trend-1', ... }] — a snapshot, safe to render a list from

chart.setPluginVisible('ma-20', false); // hides it and re-renders, but keeps its state —
                                         // toggle it back on with `true` later
```

`visible` defaults to `true`; a hidden plugin is skipped both when drawing and when a pointer
gesture is being offered around, so a hidden drawing tool can't be nudged by an accidental
click while it's toggled off. `id` is optional and opaque to the chart — it's never generated
or validated for uniqueness, just compared with `===` when you call `setPluginVisible`. A
plugin with no `id` still works exactly as before; it just can't be targeted that way, only by
holding onto its reference and calling `removePlugin` directly.

### Cleanup

Call `chart.destroy()` when you're done with a chart (component unmount, etc.) — it removes a
window-level listener and cancels any pending scheduled render that a plain garbage collect
wouldn't clean up on its own.

## Architecture

- **`crates/cinderchart-core`** (Rust → WASM): owns the one numeric hot path that's actually
  the charting engine's own — domain→pixel scaling over large series, where avoiding JS
  interpreter overhead shows up in a profile. Deliberately not indicator math; see
  "Indicators" below.
- **`src/`** (TypeScript): the public API and the Canvas2D renderer.
  - `CinderChart` owns the canvas, event wiring (pan/zoom/price-axis drag/hover), on-demand
    data loading, and the render loop. None of it knows what's actually being plotted — see
    "Series types" below.
  - `Viewport` is the pure pan/zoom/value-range state — no DOM, fully unit tested. "Value"
    is deliberately generic (`valueRangeOverride`, `scaleValueRange`, ...): it's whatever
    the active series's y-domain is, price for candlesticks and no different in kind for
    a future series with its own value domain.
  - `setDataLoader()` lets the chart pull more history on demand as the user pans toward
    either edge of what's loaded, without the library ever making a network call itself —
    see `src/dataSource.ts`.
  - Small series use a plain-JS `LinearScale` (see `src/scale.ts`); at
    `WASM_SCALE_THRESHOLD` points (see `src/hybridScale.ts`) the renderer switches to the
    compiled WASM `Scale` instead, batching each frame's coordinate mapping into one
    `mapMany` call per array rather than one JS↔WASM crossing per point.

The WASM module loads in the background the moment a `CinderChart` is constructed
(`src/wasm.ts` + `src/wasmImporter.ts`) and is never awaited on the render path — every
frame before it resolves just uses the JS scale, so there's no load-time flash or blocking.

### Engine-level styling vs. series style

`ChartRenderer` resolves `CinderChartOptions.font`/`axis`/`crosshair`/`legend` once, in its
constructor (each merged field-by-field over its own `DEFAULT_*` object in `renderer.ts`),
into private fields it reads from everywhere it used to reference a module-level constant —
axis strip sizing (`chartWidth`/`chartHeight` derive from `axis.priceWidth`/`timeHeight`
instead of fixed numbers), tick counts, every color, every font string, crosshair label
padding. None of it is series-specific: a future line series draws through the exact same
axes, crosshair, and legend chrome a candlestick chart does, so this styling lives one level
above `SeriesDefinition`, not inside it. `CandlestickStyle` (`src/series/candlestick.ts`) is
the series-level counterpart — `bodyWidthRatio`, `volumeAreaHeightRatio`, `volumeBarOpacity`
alongside the original `upColor`/`downColor` — for the handful of things that only make sense
for *this* series (a line series wouldn't have a body width or volume bars to configure).

### Series types

Candlesticks are the only chart type today, but nothing above `src/series/` knows that.
`CinderChart` and `ChartRenderer` are generic over a point shape (`SeriesPoint` — just a
`time`) and delegate every type-specific decision — how to compute the value-axis range,
how to draw the visible points, what a hover legend says — to a
`SeriesDefinition` (see `src/series/types.ts`) resolved at construction time from
`options.type` via a small registry (`src/series/registry.ts`). `src/series/candlestick.ts`
is the reference implementation: it registers itself as `'candlestick'` on import, which is
why importing `cinder-charts` at all is enough to make that type available without the caller
registering anything.

Adding a second chart type (line, area, bar, ...) means writing one new file that
implements `SeriesDefinition<TPoint, TStyle>` and calling `registerSeries` on it — `Viewport`,
event handling, data loading, and WASM scale dispatch are all untouched, and existing
`type: 'candlestick'` charts keep working exactly as before. This is the extension point the
`type` option and `style` option are built around: `style` is whatever shape the chosen
series's `defaultStyle` declares (candlestick's is `{ upColor, downColor }`), merged over
that default rather than hardcoded into the chart itself.

`options.type` is a plain string the registry resolves at runtime, so `new CinderChart(canvas,
{ type: 'candlestick', style: {...} })` type-checks even if `style` has nothing to do with
`CandlestickStyle` — nothing ties a runtime string to a specific `TPoint`/`TStyle` pair at the
type level. `createCandlestickChart()` (in `src/index.ts`) is the fix for the one built-in
type: a thin wrapper that pins both generics so its `style` is fully checked. A new series
should export an equivalent `create<Name>Chart` next to it rather than widening
`CinderChartOptions` itself, so each series's style shape stays independent of every other's.

### Plugins (markers, annotations, drawing tools)

A second, narrower extension point covers anything drawn *on top of* a chart without being
a chart type of its own — price markers, alert lines, annotations, indicator overlays.
`CinderChart.addPlugin()` registers an object implementing `ChartPlugin<TPoint>`
(`src/plugins/types.ts`); `ChartRenderer` calls its `draw()` once per frame, after the series
and axes, with a `PluginRenderApi<TPoint>` built fresh from that frame's own pan/zoom state
(`xForIndex`, `yForValue`, chart geometry, plus `allPoints` — the full loaded series, not just
what's visible, and `visibleStartIndex`/`visibleEndIndex` to know which of it is on screen).

Each plugin's `draw()` runs wrapped in its own `ctx.save()`/`ctx.restore()` and its own
`try`/`catch`: a plugin that leaves canvas state dirty (`strokeStyle`, line dash, ...) can't
bleed it into the next plugin or into next frame's axes, and a plugin that throws gets logged
via `console.error` and skipped rather than blanking the rest of the chart. `yForValue` (and,
by contract, `xForIndex`) must only be called synchronously inside that one `draw()` call —
above the `WASM_SCALE_THRESHOLD` point count, `yForValue` closes over a WASM-backed scale
that's freed the moment `draw()` returns, and calling it later throws rather than touching
freed memory.

A `ChartPlugin` that only implements `draw()` covers markers and indicator overlays — anything
purely computed from data. A drawing tool (a trend line the user places by dragging) needs
two things `draw()` alone can't give it, both added specifically to make that buildable:

- **Inverse coordinate mapping** — `PluginRenderApi.indexForX`/`valueForY`, the exact
  inverses of `xForIndex`/`yForValue` (`xForIndex(indexForX(x)) === x`). Computed directly
  from the same `valueMin`/`valueMax`/`chartHeight`/`slotWidth` the forward direction already
  uses — no changes to `Scale`/`hybridScale.ts`/the WASM crate were needed, since inverting a
  pointer position happens on user gestures, not once per point per frame, so it was never a
  case the batched/WASM-accelerated path was for.
- **Pointer gesture claiming** — `ChartPlugin.onPointerDown`/`onPointerMove`/`onPointerUp`.
  `CinderChart` offers every pointer-down inside the chart area (never the price-axis strip)
  to its plugins in reverse-registration order *before* deciding its own pan/price-scale
  mode; the first plugin whose `onPointerDown` returns `true` becomes the gesture's sole
  owner (`activeGesturePlugin`) until pointer-up, and the chart's own panning/hover is
  suppressed for that gesture entirely. A second touch landing mid-gesture ends it early
  (calls `onPointerUp`) the same way it already cancelled an in-progress scrub. Each
  `ChartPointerEvent` carries the raw pixel position plus the same `index`/`value` conversion
  `indexForX`/`valueForY` do, computed via `frameValueRange()` — the same value-range logic
  `ChartRenderer.render` uses, recomputed on demand since pointer events happen between
  frames, not during one.

### Indicators (moving averages, Bollinger Bands, ...): deliberately not included

cinder-charts ships the extension point (`ChartPlugin`, `allPoints`, `xForIndex`/`yForValue`)
and nothing built on top of it. This was a real decision, not an oversight — charting
libraries generally land somewhere on a spectrum: some ship no indicators at all, only a
generic primitive/plugin API plus docs on building your own, leaving actual indicators to a
community ecosystem; some bundle dozens directly into the core with a registration escape
hatch for custom ones; some ship official indicators the vendor maintains, but as separate
opt-in modules on top of a public extension class, so a consumer who never touches indicators
never pays for them; and some have no indicator concept at all, treating an indicator as
nothing more than an ordinary dataset the application computes and plots itself.

cinder-charts follows the first pattern: indicator math has too many real conventions (SMA vs.
EMA, population vs. sample standard deviation, Wilder's smoothing for RSI, ...) for a charting
engine to pick one and call it correct for everyone, and every one bundled is one more thing
this library has to maintain forever. `demo/index.html` has a from-scratch moving-average
`ChartPlugin` as a worked example of what building one looks like — period and color included,
entirely in application code, not imported from the library.

```bash
# TypeScript
pnpm install
pnpm build:wasm   # wasm-pack build → wasm-pkg/ (gitignored, regenerate after touching the Rust crate)
pnpm test         # vitest
pnpm build        # tsc
pnpm demo         # builds both, then serves demo/index.html locally

# Rust
cargo test                                        # native unit tests
cargo check --target wasm32-unknown-unknown        # compiles for the wasm target
```

## Status

Interactive on both mouse and touch: pan (drag or horizontal scroll/swipe), zoom (vertical
scroll or a two-finger pinch, both cursor/midpoint-anchored), price-axis drag-to-scale,
hover crosshair with an OHLC(+volume) legend and axis labels (the horizontal line and its
price-axis label follow the actual cursor/finger row continuously, not a fixed value like the
hovered candle's close — a full date+time label follows the hovered candle on the time axis) —
a still finger held past a short delay substitutes for hover on touch, since touch has no
hover state — and on-demand history loading via `setDataLoader`. Per-candle volume bars draw in
the bottom fifth of the chart when a candle has `volume`, and are entirely omitted (nothing
drawn, nothing reserved) for data that doesn't.
Coordinate scaling runs on WASM once a frame's point count crosses the threshold, JS below
it. Candlestick is the only registered series type so far; the plugin extension point (draw
overlays plus, now, claimable pointer gestures for interactive tools — see "Plugins" above)
has no built-in users (see "Indicators" above for why) beyond `demo/index.html`'s example. No
concrete drawing tool ships yet, only the mechanism a trend line or similar would be built
on. No multi-pane support yet (volume shares the candlestick pane rather than getting its
own). Not published to npm.

## License

MIT
