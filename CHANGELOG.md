# Changelog

All notable changes to this project are documented in this file.

The format is loosely based on [Keep a Changelog](https://keepachangelog.com/),
and this project uses [Semantic Versioning](https://semver.org/).

## [0.4.0] — 2026-09-13

### Added

- **Multi-pane support** (`addPane`/`removePane`/`getPanes`, `ChartPlugin.paneId`):
  an app can now reserve a horizontal strip below the main price pane for an
  indicator or oscillator with its own independent value axis (RSI's fixed
  `[0, 100]`, say), and route a `ChartPlugin`'s `draw()` into it by `paneId`.
  The pane itself draws nothing but a separator line and its own right-side
  axis — content comes entirely from whatever plugin targets it, the same
  "core provides layout, the app provides the math" split the plugin system
  already used for indicator overlays on the price pane. See "Multi-pane
  indicators" in the README, and `demo/index.html` for a worked RSI-in-its-
  own-pane example alongside the existing moving-average overlay.
- The hover crosshair's dashed vertical line now spans every pane in the
  stack; the horizontal line, price-label chip, and OHLC legend stay scoped
  to the main pane.

## [0.3.0] — Initial release

First published version. Everything below shipped together as the initial
public API — there is no prior published version to diff against.

### Added

- **Core rendering engine**: a `<canvas>`-based candlestick chart with pan,
  zoom, price-axis drag-to-scale, hover crosshair, and on-demand history
  loading (`setDataLoader`) that fetches more data as the user pans toward
  either edge of what's currently loaded.
- **WASM-backed coordinate scaling** (`crates/wickchart-core`): the one
  numeric hot path — domain-to-pixel scaling over large series — compiled to
  WebAssembly for large datasets, with a transparent pure-JS fallback.
- **Series registry** (`registerSeries`/`getSeries`): the chart type itself
  is pluggable through a `SeriesDefinition` interface: `candlestickSeries`
  ships as the one built-in reference implementation.
- **Full style parameterization**: every color, size, and padding the chart
  draws with — `style` (series-specific: candle colors, body width, volume
  bars) plus engine-level `font`/`axis`/`crosshair`/`legend` — is an option
  with a documented default, not a fixed constant.
- **A floating hover tooltip**: the OHLC(+volume) legend follows the
  hovered pixel like a speech bubble (multi-line, boxed, offset from the
  cursor and clamped to the chart edges) rather than sitting fixed in a
  corner. Styling (`background`/`paddingX`/`paddingY`/`cursorGap`) and
  colors are all configurable through `legend`.
- **Generic plugin extension point** (`ChartPlugin`): `draw(api)` for pure
  overlays (markers, indicator lines an app computes itself), plus optional
  `onPointerDown`/`onPointerMove`/`onPointerUp` for interactive tools (trend
  lines, anything placed or edited by the user) that need to claim a
  pointer gesture away from the chart's own panning.
- **Hit-testing helpers** (`hitTestSegment`, `hitTestPoint`,
  `distanceToSegment`): the point-to-segment geometry an interactive plugin
  needs to answer "did the user click on the shape I already placed," so a
  drawing tool can be re-selected, dragged, or deleted after the fact.
  `ChartPointerEvent` gained `xForIndex`/`yForValue` — the forward mapping
  a plugin needs to convert a shape it stores in data space (so it survives
  pan/zoom) back to pixels at hit-test time.
- **Plugin management primitives**: optional `id`/`visible` fields on
  `ChartPlugin`, plus `WickChart.getPlugins()` and
  `setPluginVisible(id, visible)` — an app attaching several
  indicators/drawing tools can enumerate and toggle them without keeping
  its own parallel bookkeeping of every `addPlugin` call. The UI built on
  top of this (a list, a modal, a toast) is left entirely to the app.

### Deliberately not included

- **No built-in indicators** (moving averages, Bollinger Bands, etc.) —
  the library ships the extension point (`ChartPlugin`, `allPoints` for
  warm-up history) and nothing more; see the README's "Indicators" section
  for the reasoning and a worked example.
- **No built-in drawing tools** — same reasoning; the README's "Interactive
  plugins" section has a from-scratch trend-line example using the pointer
  gesture hooks and hit-testing helpers above.
