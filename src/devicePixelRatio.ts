/**
 * Ratio between a canvas's backing-store size and its CSS display size —
 * `canvas.width / rect.width` (or `.height`), the same signal
 * `window.devicePixelRatio` gives once a canvas has actually been resized to
 * match it (see the README's "High-DPI displays" section for the resize
 * recipe this reads back). Read live off the canvas and its bounding rect
 * rather than cached anywhere, so a change — a window dragged to a
 * different-DPI monitor, a browser zoom level change, or simply an app
 * resizing the canvas — is picked up on the very next call with no explicit
 * resize notification needed, the same way `ChartRenderer.chartWidth`/
 * `chartHeight` already track `canvas.width`/`height` live instead of
 * caching them at construction.
 *
 * Returns 1 (no scaling) when the CSS size is 0 — an unattached or
 * zero-size canvas — rather than dividing by zero.
 */
export function devicePixelRatio(canvas: HTMLCanvasElement, axis: 'width' | 'height' = 'width'): number {
  const rect = canvas.getBoundingClientRect();
  const cssSize = axis === 'width' ? rect.width : rect.height;
  const deviceSize = axis === 'width' ? canvas.width : canvas.height;
  return cssSize === 0 ? 1 : deviceSize / cssSize;
}
