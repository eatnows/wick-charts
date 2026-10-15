/**
 * Pure donut geometry — no canvas, no DOM. Everything here maps data to
 * angles/pixels (and back, for hit-testing), so it is unit-testable on its
 * own and shared by the renderer, the pointer handling, and the aria label.
 *
 * Angles are in **degrees**, `0` at 12 o'clock, increasing clockwise — the
 * way people read a pie, not canvas's 3-o'clock/radians convention (the
 * renderer converts with `toCanvasRadians`).
 */

/** One slice's input. `TDatum` is an arbitrary caller payload that rides
 * along on `DonutArc.segment.data` so callbacks and formatters can get the
 * original object back without a lookup by `key`. */
export interface DonutSegment<TDatum = unknown> {
  /** Stable identifier — what `setHighlight`/`setSelected` and the
   * callbacks refer to a slice by. Should be unique. */
  key: string;
  label: string;
  value: number;
  /** Any CSS color. Falls back to `DonutOptions.palette`, by position in the
   * input array (so a slice's color doesn't shift when another one's value
   * drops to 0 and it disappears). */
  color?: string;
  data?: TDatum;
}

/** A segment after layout: its angular span and share of the total. */
export interface DonutArc<TDatum = unknown> {
  /** Position among the *rendered* arcs (zero/invalid segments skipped). */
  index: number;
  key: string;
  segment: DonutSegment<TDatum>;
  value: number;
  /** Share of the total, `0..1`, unrounded — the fractions of all arcs sum
   * to exactly 1 (display rounding is `formatPercent`'s job, and does not
   * try to make the printed percentages add to 100). */
  fraction: number;
  /** Logical span, before `gap` is carved out of it; absolute (includes the
   * chart's `startAngle`, so may exceed 360). */
  startAngle: number;
  endAngle: number;
  /** Resolved fill color (`segment.color` or the palette's). */
  color: string;
}

/** Resolved geometry in **canvas backing-store pixels**. */
export interface DonutGeometry {
  cx: number;
  cy: number;
  outerRadius: number;
  innerRadius: number;
  startAngle: number;
  sweep: number;
}

export const DEFAULT_PALETTE: readonly string[] = [
  '#4e79a7',
  '#f28e2b',
  '#e15759',
  '#76b7b2',
  '#59a14f',
  '#edc948',
  '#b07aa1',
  '#ff9da7',
  '#9c755f',
  '#bab0ac',
];

/** Degrees (0 = 12 o'clock, clockwise) to canvas radians (0 = 3 o'clock). */
export function toCanvasRadians(degrees: number): number {
  return ((degrees - 90) * Math.PI) / 180;
}

function isValidValue(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

/** Turns segments into arcs spanning `sweep` degrees from `startAngle`.
 * Zero, negative, and non-finite values are skipped (they have no area);
 * the percentage denominator is the sum of the rest. */
export function computeDonutArcs<TDatum>(
  segments: readonly DonutSegment<TDatum>[],
  options: { palette?: readonly string[]; startAngle?: number; sweep?: number } = {},
): DonutArc<TDatum>[] {
  const { palette = DEFAULT_PALETTE, startAngle = 0, sweep = 360 } = options;
  const valid = segments
    .map((segment, position) => ({ segment, position }))
    .filter(({ segment }) => isValidValue(segment.value));
  const total = valid.reduce((sum, { segment }) => sum + segment.value, 0);

  let cursor = startAngle;
  return valid.map(({ segment, position }, index) => {
    const fraction = segment.value / total;
    const arc: DonutArc<TDatum> = {
      index,
      key: segment.key,
      segment,
      value: segment.value,
      fraction,
      startAngle: cursor,
      endAngle: cursor + fraction * sweep,
      color: segment.color ?? palette[position % palette.length]!,
    };
    cursor = arc.endAngle;
    return arc;
  });
}

/** Fits the ring into a `width`x`height` canvas (backing-store px), leaving
 * `padding` px free around it so a grown/outlined slice is never clipped.
 * `innerRatio` is the hole's radius as a fraction of the outer radius
 * (`0` = a full pie). */
export function computeDonutGeometry(
  width: number,
  height: number,
  options: { innerRatio: number; padding: number; startAngle: number; sweep: number },
): DonutGeometry {
  const outerRadius = Math.max(0, Math.min(width, height) / 2 - options.padding);
  const ratio = Math.min(Math.max(options.innerRatio, 0), 1);
  return {
    cx: width / 2,
    cy: height / 2,
    outerRadius,
    innerRadius: outerRadius * ratio,
    startAngle: options.startAngle,
    sweep: options.sweep,
  };
}

/** The angular span actually painted for an arc: its logical span minus
 * half the gap on each side. The gap is a constant *angle* (the pixel gap
 * converted at the ring's mid radius), so the seam is slightly wider at the
 * outer edge than the inner one. A lone arc gets no gap, and a gap never
 * eats more than half an arc (so tiny slices stay visible). */
export function paintedAngles(
  arc: Pick<DonutArc, 'startAngle' | 'endAngle'>,
  arcCount: number,
  gapPx: number,
  geometry: DonutGeometry,
): { start: number; end: number } {
  const midRadius = (geometry.outerRadius + geometry.innerRadius) / 2;
  if (arcCount < 2 || gapPx <= 0 || midRadius <= 0) return { start: arc.startAngle, end: arc.endAngle };
  const gapDegrees = ((gapPx / midRadius) * 180) / Math.PI;
  const span = arc.endAngle - arc.startAngle;
  const half = Math.min(gapDegrees / 2, span / 4);
  return { start: arc.startAngle + half, end: arc.endAngle - half };
}

/** The arc under `(x, y)` (backing-store px), or `null` for the hole, the
 * outside, or a gauge's empty remainder. Tests the *logical* span at the
 * un-grown radius, so growing a hovered slice never changes what hits. */
export function hitTestArc<TDatum>(
  arcs: readonly DonutArc<TDatum>[],
  geometry: DonutGeometry,
  x: number,
  y: number,
): DonutArc<TDatum> | null {
  const dx = x - geometry.cx;
  const dy = y - geometry.cy;
  const distance = Math.hypot(dx, dy);
  if (distance > geometry.outerRadius || distance < geometry.innerRadius) return null;

  // Angle from 12 o'clock, clockwise, relative to where the ring starts.
  const theta = (Math.atan2(dx, -dy) * 180) / Math.PI;
  const relative = (((theta - geometry.startAngle) % 360) + 360) % 360;
  if (relative > geometry.sweep) return null;

  return arcs.find((arc) => relative >= arc.startAngle - geometry.startAngle && relative < arc.endAngle - geometry.startAngle)
    ?? (relative === geometry.sweep ? (arcs[arcs.length - 1] ?? null) : null);
}

/** `"Label 12.3%, Label 4.5%"` — the canvas's `aria-label`. */
export function donutAriaLabel(
  arcs: readonly DonutArc[],
  formatPercent: (fraction: number) => string,
  emptyText = 'No data',
): string {
  if (arcs.length === 0) return emptyText;
  return arcs.map((arc) => `${arc.segment.label} ${formatPercent(arc.fraction)}`).join(', ');
}
