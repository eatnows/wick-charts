/**
 * Pure layout math for stacking a chart's panes vertically — no canvas, no
 * DOM, fully unit-testable in isolation from `ChartRenderer`. The main
 * (price) pane is never passed in here: it's whatever height remains after
 * every declared pane's `heightRatio` share of the total plotting height
 * (canvas height minus the time-axis strip) is subtracted, which is why it
 * always exists even with zero declared panes.
 */

/** One caller-declared pane's layout inputs — a subset of `PaneOptions`
 * (see `src/types.ts`), kept separate so this module doesn't need to know
 * about `getValueRange`/`valueRange` at all. */
export interface PaneLayoutInput {
  id: string;
  /** Fraction of the total plotting height this pane occupies, before
   * clamping. Clamped into `[MIN_PANE_HEIGHT_RATIO, MAX_TOTAL_PANE_RATIO]`
   * as a share of the whole stack — see `computePaneLayout`. */
  heightRatio: number;
}

/** One pane's resolved pixel rect within the plotting area (i.e. relative
 * to the top of the chart, above the time-axis strip — the same origin
 * `ChartRenderer.chartHeight` already uses). */
export interface PaneRect {
  id: string;
  top: number;
  height: number;
}

/** Floor on any single pane's share of the stack, main pane included — a
 * pane asked to render at near-zero height is worse than one slightly
 * taller than requested; nothing usable can be drawn (axis ticks, a
 * legible plot) below this. */
const MIN_PANE_HEIGHT_RATIO = 0.05;

/** Ceiling on how much of the total plotting height every declared pane
 * *combined* may claim, leaving at least this much for the main pane even
 * if the sum of requested ratios would otherwise consume it entirely. */
const MAX_TOTAL_PANE_RATIO = 0.8;

/**
 * Resolves every declared pane's pixel rect plus the main pane's, stacked
 * top (price pane) to bottom (declared panes, in call order) inside
 * `totalHeight` px. Declared ratios are scaled down proportionally (not
 * clamped one by one, which would silently change the relative sizing
 * between panes) whenever their sum would leave the main pane below
 * `MIN_PANE_HEIGHT_RATIO` of the stack.
 */
export function computePaneLayout(panes: PaneLayoutInput[], totalHeight: number): {
  main: PaneRect;
  panes: PaneRect[];
} {
  const height = Math.max(0, totalHeight);
  if (panes.length === 0) {
    return { main: { id: 'main', top: 0, height }, panes: [] };
  }

  const rawRatios = panes.map((p) => Math.max(MIN_PANE_HEIGHT_RATIO, p.heightRatio));
  const rawTotal = rawRatios.reduce((sum, r) => sum + r, 0);
  // Scale every declared pane down by the same factor if together they'd
  // eat more than MAX_TOTAL_PANE_RATIO of the stack — proportional, so a
  // pane asking for twice another's height still ends up twice as tall.
  const scale = rawTotal > MAX_TOTAL_PANE_RATIO ? MAX_TOTAL_PANE_RATIO / rawTotal : 1;
  const ratios = rawRatios.map((r) => r * scale);

  let top = 0;
  const mainHeight = height * (1 - ratios.reduce((sum, r) => sum + r, 0));
  const main: PaneRect = { id: 'main', top, height: mainHeight };
  top += mainHeight;

  const rects: PaneRect[] = panes.map((pane, i) => {
    const paneHeight = height * ratios[i]!;
    const rect: PaneRect = { id: pane.id, top, height: paneHeight };
    top += paneHeight;
    return rect;
  });

  return { main, panes: rects };
}
