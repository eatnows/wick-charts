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
  - Small series use a plain-JS `LinearScale` (see `src/scale.ts`); at
    `WASM_SCALE_THRESHOLD` points (see `src/hybridScale.ts`) the renderer switches to the
    compiled WASM `Scale` instead, batching each frame's coordinate mapping into one
    `mapMany` call per array rather than one JS↔WASM crossing per point.

The WASM module loads in the background the moment a `CinderChart` is constructed
(`src/wasm.ts` + `src/wasmImporter.ts`) and is never awaited on the render path — every
frame before it resolves just uses the JS scale, so there's no load-time flash or blocking.

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

Interactive: pan (drag or horizontal scroll), zoom (vertical scroll, cursor-anchored),
price-axis drag-to-scale, hover crosshair with an OHLC legend, and on-demand history
loading via `setDataLoader`. Coordinate scaling runs on WASM once a frame's point count
crosses the threshold, JS below it. No drawing tools or multi-pane indicators yet. Not
published to npm.

## License

MIT
