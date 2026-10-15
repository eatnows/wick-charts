import type { ChartFontOptions, ChartLegendOptions, LegendLine, LegendSegment } from './types.js';

/** Normalizes any `LegendLine` shape to the one form actually drawn:
 * a list of colored segments (a plain string/line becomes one segment
 * with no color override). */
export function toSegments(line: LegendLine): LegendSegment[] {
  if (typeof line === 'string') return [{ text: line }];
  if (Array.isArray(line)) return line;
  return [line];
}

/**
 * Draws a hover legend box — one `LegendLine` per row on a filled
 * background, floating up-and-right of `anchor` by `legend.cursorGap` and
 * clamped inside `bounds` so it never runs off the chart. Shared by the
 * crosshair legend and any other chart type that wants the same tooltip
 * (e.g. the donut chart) so they lay out and clamp identically.
 *
 * Every size in `legend`/`font` must already be in the canvas's
 * backing-store pixels (callers scale CSS-px options by their device-pixel
 * ratio first — see `ChartRenderer.render`). Returns the box's rect.
 */
export function drawLegendBox(
  ctx: CanvasRenderingContext2D,
  lines: LegendLine[],
  anchor: { x: number; y: number },
  bounds: { width: number; height: number },
  legend: Required<ChartLegendOptions>,
  font: Required<ChartFontOptions>,
): { left: number; top: number; width: number; height: number } {
  ctx.font = `${font.legendSize}px ${font.family}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';

  // Normalize every line to its segments once up front — sizing needs
  // each line's full concatenated width; drawing needs each segment's
  // own color (falling back to legend.textColor).
  const segmentedLines = lines.map(toSegments);
  const lineHeight = font.legendSize + 4;
  const textWidth = Math.max(
    ...segmentedLines.map((segments) => segments.reduce((w, seg) => w + ctx.measureText(seg.text).width, 0)),
  );
  const boxWidth = textWidth + legend.paddingX * 2;
  const boxHeight = lines.length * lineHeight + legend.paddingY * 2;

  const left = Math.min(Math.max(anchor.x + legend.cursorGap, 0), Math.max(0, bounds.width - boxWidth));
  const top = Math.min(
    Math.max(anchor.y - boxHeight - legend.cursorGap, 0),
    Math.max(0, bounds.height - boxHeight),
  );

  ctx.fillStyle = legend.background;
  ctx.fillRect(left, top, boxWidth, boxHeight);

  segmentedLines.forEach((segments, i) => {
    let segX = left + legend.paddingX;
    const y = top + legend.paddingY + i * lineHeight;
    for (const seg of segments) {
      ctx.fillStyle = seg.color ?? legend.textColor;
      ctx.fillText(seg.text, segX, y);
      segX += ctx.measureText(seg.text).width;
    }
  });

  return { left, top, width: boxWidth, height: boxHeight };
}
