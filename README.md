# cinderchart

An open-source financial charting library. WASM (Rust) for compute, Canvas2D for rendering.

## Why

A serious trading UI needs more than a candlestick renderer on a page — drawing tools,
multi-pane indicator stacks, replay, and large-series performance all matter once real
usage starts. cinderchart aims to cover that ground natively from the start, while keeping
rendering on the simplest thing that can possibly work (Canvas2D — no WebGL until profiling
says it's actually needed).

## Usage

Not published to npm yet — for now, clone this repo, build it, and import from its `dist/`
(either via a local path/workspace dependency, or by copying `dist/` and `wasm-pkg/` into your
own project, keeping them siblings — see "Install" below for why that layout matters).

### Install

```bash
git clone <this-repo> cinderchart
cd cinderchart
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
import { createCandlestickChart } from 'cinderchart';

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

`setData()` sorts by time itself, so passing data in any order (or re-calling it with a fresh
array) is safe. It resets pan/zoom/hover state — call it for a genuinely new dataset, and use
`setDataLoader()` (below) to extend the current one instead.

### Styling

```ts
const chart = createCandlestickChart(canvas, {
  background: '#0d1117',
  style: { upColor: '#26a69a', downColor: '#ef5350' },
});
```

`background` is transparent by default. `style` is merged over the series's own defaults, so
you only need to specify what you're overriding. `createCandlestickChart` type-checks `style`
against `CandlestickStyle`; the more general `new CinderChart(canvas, { type: 'candlestick',
style })` also works but doesn't — see "Series types" below for why, if you're curious.

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
`removePlugin()` takes the same object back out.

### Cleanup

Call `chart.destroy()` when you're done with a chart (component unmount, etc.) — it removes a
window-level listener and cancels any pending scheduled render that a plain garbage collect
wouldn't clean up on its own.

## Architecture

- **`crates/cinderchart-core`** (Rust → WASM): owns numeric hot paths — domain→pixel
  scaling and indicator math (moving averages, etc.) — where avoiding JS interpreter
  overhead over large series actually shows up in a profile.
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

### Series types

Candlesticks are the only chart type today, but nothing above `src/series/` knows that.
`CinderChart` and `ChartRenderer` are generic over a point shape (`SeriesPoint` — just a
`time`) and delegate every type-specific decision — how to compute the value-axis range,
how to draw the visible points, what a hover legend says — to a `SeriesDefinition` (see
`src/series/types.ts`) resolved at construction time from `options.type` via a small
registry (`src/series/registry.ts`). `src/series/candlestick.ts` is the reference
implementation: it registers itself as `'candlestick'` on import, which is why importing
`cinderchart` at all is enough to make that type available without the caller registering
anything.

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
a chart type of its own — price markers, alert lines, annotations. `CinderChart.addPlugin()`
registers an object implementing `ChartPlugin` (`src/plugins/types.ts`); `ChartRenderer`
calls its `draw()` once per frame, after the series and axes, with a `PluginRenderApi` built
fresh from that frame's own pan/zoom state (`xForIndex`, `yForValue`, chart geometry). No
concrete plugin ships yet — the hook exists so a marker implementation can be added later as
its own file, without ever touching `CinderChart` or `ChartRenderer`.

Each plugin's `draw()` runs wrapped in its own `ctx.save()`/`ctx.restore()` and its own
`try`/`catch`: a plugin that leaves canvas state dirty (`strokeStyle`, line dash, ...) can't
bleed it into the next plugin or into next frame's axes, and a plugin that throws gets logged
via `console.error` and skipped rather than blanking the rest of the chart. `yForValue` (and,
by contract, `xForIndex`) must only be called synchronously inside that one `draw()` call —
above the `WASM_SCALE_THRESHOLD` point count, `yForValue` closes over a WASM-backed scale
that's freed the moment `draw()` returns, and calling it later throws rather than touching
freed memory.

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
hover crosshair with an OHLC legend (a still finger held past a short delay substitutes for
hover on touch, since touch has no hover state), and on-demand history loading via
`setDataLoader`.
Coordinate scaling runs on WASM once a frame's point count crosses the threshold, JS below
it. Candlestick is the only registered series type so far, and no concrete marker/annotation
plugin ships yet — both extension points exist but have one and zero built-in users,
respectively. No multi-pane indicators yet. Not published to npm.

## License

MIT
