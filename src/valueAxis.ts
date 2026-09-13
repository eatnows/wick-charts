/**
 * Pure pixel<->value mapping helpers for a chart's value axis, factored out
 * so `WickChartOptions.invertValueAxis` (see `src/index.ts`) has exactly
 * one place to change the y-direction convention instead of several
 * independently re-derived copies of the same formula. Before this file
 * existed, `ChartRenderer`'s hover-crosshair value readout, its per-pane
 * `PluginRenderApi.valueForY`, and `WickChart`'s own pointer-event
 * `value`/`yForValue` each inlined the same "pixel -> value" arithmetic
 * separately — harmless while there was only ever one direction, but
 * exactly the kind of duplication that turns "add an invert option" into
 * "find and fix four copies of a formula, hope none were missed."
 *
 * The forward, per-point-in-a-frame hot path stays on `Scale`
 * (`src/hybridScale.ts`, JS or WASM) for its own reasons — batched
 * `mapMany`, no per-point allocation. `valueAxisPixelRange` only decides
 * which pixel end a `Scale` should treat as the domain minimum, so
 * inverting is a one-line change to how a `Scale` gets constructed rather
 * than a second rendering path. `valueToPixel`/`pixelToValue` below are for
 * the comparatively rare user-gesture paths (hover crosshair, pointer
 * events, price-axis dragging) where a `Scale` instance either doesn't
 * exist yet (these happen between frames) or isn't worth constructing for
 * a single one-off conversion.
 */

/**
 * The `[rangeMin, rangeMax]` pair to construct a value-axis `Scale` with:
 * `createScale(domainMin, domainMax, ...valueAxisPixelRange(pixelSpan, inverted))`.
 * Not inverted (the default for every chart): the domain maximum renders
 * at pixel 0 (the top of the pane) and the minimum at `pixelSpan` (the
 * bottom). Inverted: the same two pixels, swapped — every value renders
 * mirrored top-to-bottom, with no change to the underlying data.
 */
export function valueAxisPixelRange(pixelSpan: number, inverted: boolean): [number, number] {
  return inverted ? [0, pixelSpan] : [pixelSpan, 0];
}

/**
 * value -> pixel, the exact forward direction `valueAxisPixelRange` sets a
 * `Scale` up for. `pixelSpan` is the pane's own height (or a candidate
 * one — this has no dependency on `Scale` or a live frame).
 */
export function valueToPixel(
  value: number,
  valueMin: number,
  valueMax: number,
  pixelSpan: number,
  inverted: boolean,
): number {
  const t = (value - valueMin) / (valueMax - valueMin);
  return inverted ? t * pixelSpan : (1 - t) * pixelSpan;
}

/**
 * pixel -> value, the exact inverse of `valueToPixel` above —
 * `valueToPixel(pixelToValue(pixel, ...), ...) === pixel` for any `pixel`
 * in `[0, pixelSpan]`.
 */
export function pixelToValue(
  pixel: number,
  valueMin: number,
  valueMax: number,
  pixelSpan: number,
  inverted: boolean,
): number {
  const t = inverted ? pixel / pixelSpan : 1 - pixel / pixelSpan;
  return valueMin + t * (valueMax - valueMin);
}
