/**
 * Perpendicular distance, in px, from `(px, py)` to the line segment
 * `(x1, y1)`-`(x2, y2)` — clamped to the segment itself, so a point beyond
 * either endpoint measures against that endpoint rather than the infinite
 * line the segment sits on.
 *
 * Every interactive plugin that draws a line-shaped thing (a trend line, a
 * ray, an edge of a rectangle) eventually needs to answer "did the user
 * click on/near the thing I already placed" so it can be selected, dragged,
 * or deleted — and the endpoint-clamping is easy to get subtly wrong when
 * re-derived per plugin, so it lives here once instead.
 */
export function distanceToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(px - x1, py - y1); // a zero-length "segment" is just a point
  let t = ((px - x1) * dx + (py - y1) * dy) / lengthSquared;
  t = Math.max(0, Math.min(1, t));
  const closestX = x1 + t * dx;
  const closestY = y1 + t * dy;
  return Math.hypot(px - closestX, py - closestY);
}

/**
 * `true` if `(px, py)` is within `tolerancePx` of the segment
 * `(x1, y1)`-`(x2, y2)`. Defaults to 6px — comfortably clickable with a
 * mouse pointer, still forgiving enough for an imprecise fingertip on
 * touch. Call it from `onPointerDown`/`onPointerMove` with the event's
 * `x`/`y` and the shape's own endpoints converted to pixels via the
 * event's `xForIndex`/`yForValue` (a shape stored in data space survives
 * pan/zoom; converting it to pixels at hit-test time, rather than storing
 * pixels directly, is what keeps a placed line lined up with the candles
 * it was drawn against after the user scrolls or zooms).
 */
export function hitTestSegment(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  tolerancePx = 6,
): boolean {
  return distanceToSegment(px, py, x1, y1, x2, y2) <= tolerancePx;
}

/**
 * `true` if `(px, py)` is within `tolerancePx` of the point `(x, y)` — for
 * hit-testing a marker, a drag handle, or a single endpoint of a shape
 * rather than an edge.
 */
export function hitTestPoint(px: number, py: number, x: number, y: number, tolerancePx = 6): boolean {
  return Math.hypot(px - x, py - y) <= tolerancePx;
}
