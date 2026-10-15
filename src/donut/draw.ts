import { paintedAngles, toCanvasRadians } from './layout.js';
import type { DonutArc, DonutGeometry } from './layout.js';

/** Draw-time style, already in backing-store pixels — `DonutChart` scales
 * its CSS-px options by the device-pixel ratio before building this. */
export interface DonutDrawStyle {
  trackColor: string;
  gap: number;
  /** `null` = hover emphasis disabled. */
  hover: { grow: number; dim: number } | null;
  selected: { grow: number; outlineColor: string; outlineWidth: number };
}

export interface DonutDrawState {
  highlightKey: string | null;
  selectedKey: string | null;
}

/** Traces an annular sector. Spans of 360° or more trace the full ring
 * (the radial seams coincide, so they add no area). */
function sectorPath(
  ctx: CanvasRenderingContext2D,
  g: DonutGeometry,
  startDeg: number,
  endDeg: number,
  outer: number,
  inner: number,
): void {
  const a0 = toCanvasRadians(startDeg);
  const a1 = toCanvasRadians(endDeg);
  ctx.beginPath();
  ctx.arc(g.cx, g.cy, outer, a0, a1);
  ctx.arc(g.cx, g.cy, inner, a1, a0, true);
  ctx.closePath();
}

/** Paints the track and every arc. Emphasized arcs (highlighted/selected)
 * draw last so a grown slice overlaps its neighbors instead of hiding
 * behind them. */
export function drawDonut(
  ctx: CanvasRenderingContext2D,
  arcs: readonly DonutArc[],
  g: DonutGeometry,
  style: DonutDrawStyle,
  state: DonutDrawState,
): void {
  ctx.save();

  ctx.fillStyle = style.trackColor;
  sectorPath(ctx, g, g.startAngle, g.startAngle + g.sweep, g.outerRadius, g.innerRadius);
  ctx.fill();

  const emphasized = (arc: DonutArc) => arc.key === state.selectedKey || (style.hover !== null && arc.key === state.highlightKey);
  const dimOthers = style.hover !== null && state.highlightKey !== null;
  const ordered = [...arcs.filter((a) => !emphasized(a)), ...arcs.filter(emphasized)];

  for (const arc of ordered) {
    const isSelected = arc.key === state.selectedKey;
    const isHighlighted = style.hover !== null && arc.key === state.highlightKey;
    const grow = Math.max(isSelected ? style.selected.grow : 0, isHighlighted ? style.hover!.grow : 0);
    const { start, end } = paintedAngles(arc, arcs.length, style.gap, g);

    ctx.globalAlpha = dimOthers && !isHighlighted && !isSelected ? style.hover!.dim : 1;
    ctx.fillStyle = arc.color;
    sectorPath(ctx, g, start, end, g.outerRadius + grow, g.innerRadius);
    ctx.fill();

    if (isSelected && style.selected.outlineWidth > 0) {
      ctx.globalAlpha = 1;
      ctx.strokeStyle = style.selected.outlineColor;
      ctx.lineWidth = style.selected.outlineWidth;
      ctx.stroke();
    }
  }

  ctx.restore();
}
