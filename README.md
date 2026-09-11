# cinderchart

An open-source financial charting library. WASM (Rust) for compute, Canvas2D for rendering.

## Why

A serious trading UI needs more than a candlestick renderer on a page — drawing tools,
multi-pane indicator stacks, replay, and large-series performance all matter once real
usage starts. cinderchart aims to cover that ground natively from the start, while keeping
rendering on the simplest thing that can possibly work (Canvas2D — no WebGL until profiling
says it's actually needed).

## Architecture

- **`crates/cinderchart-core`** (Rust → WASM): owns numeric hot paths — domain→pixel
  scaling and indicator math (moving averages, etc.) — where avoiding JS interpreter
  overhead over large series actually shows up in a profile.
- **`src/`** (TypeScript): the public API and the Canvas2D renderer.
  - `CinderChart` owns the canvas, event wiring (pan/zoom/price-axis drag/hover), and the
    render loop.
  - `Viewport` is the pure pan/zoom/price-range state — no DOM, fully unit tested.
  - `setDataLoader()` lets the chart pull more history on demand as the user pans toward
    either edge of what's loaded, without the library ever making a network call itself —
    see `src/dataSource.ts`.
  - Small series use a plain-JS `LinearScale` (see `src/scale.ts`); the WASM `Scale` is the
    drop-in replacement once profiling says a series is large enough to justify the
    JS↔WASM boundary cost.

The JS and WASM halves are **not wired together yet**. Each half builds and tests
independently:

```bash
# TypeScript
pnpm install
pnpm test        # vitest
pnpm build       # tsc
pnpm demo        # builds, then serves demo/index.html locally

# Rust
cargo test                                        # native unit tests
cargo check --target wasm32-unknown-unknown        # compiles for the wasm target
```

Wiring the two together (via `wasm-bindgen` + `wasm-pack`, published as an internal
dependency of the TS package) is the next milestone, once there's a real perf case to
justify where the boundary should sit.

## Status

Interactive: pan (drag or horizontal scroll), zoom (vertical scroll, cursor-anchored),
price-axis drag-to-scale, hover crosshair with an OHLC legend, and on-demand history
loading via `setDataLoader`. No drawing tools or multi-pane indicators yet. Not published
to npm.

## License

MIT
