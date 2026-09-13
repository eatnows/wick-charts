import { formatHoverTime } from './axis.js';
import { formatPrice } from './priceAxis.js';
import { pixelToValue } from './valueAxis.js';
import type { ChartCrosshairOptions, ChartFontOptions, ChartLegendOptions } from './types.js';

/** Everything one frame's hover crosshair/legend needs — computed by
 * `ChartRenderer.render()` (which owns the hovered point, the active
 * series, and its style) and handed in as plain data so this class stays
 * generic-free and series-agnostic. `legendParts` is already the result of
 * `seriesDefinition.formatLegend?.(point, style)` — this class only lays
 * out and draws whatever strings it's given. */
export interface CrosshairRenderInput {
  x: number;
  timeSeconds: number;
  hoverY: number | null;
  valueMin: number;
  valueMax: number;
  priceStep: number;
  chartWidth: number;
  chartHeight: number;
  /** Full pane-stack height — the dashed vertical line spans this, not
   * just `chartHeight` (the main pane's own), so a hovered candle lines up
   * across every indicator pane below it. */
  stackHeight: number;
  invertValueAxis: boolean;
  legendParts: string[];
  /** The canvas's own backing-store width — needed only to clamp the
   * time-axis label chip so it never runs off the right edge. */
  canvasWidth: number;
}

/**
 * Draws the hover crosshair (dashed lines), its price/time label chips,
 * and the OHLC-style legend tooltip. Split out of `ChartRenderer` for the
 * same reason `AxisRenderer` was: everything it needs arrives as
 * already-resolved style options plus one frame's worth of plain data
 * (`CrosshairRenderInput`) — no series generic, no plugin state.
 */
export class CrosshairRenderer {
  constructor(
    private ctx: CanvasRenderingContext2D,
    private crosshair: Required<ChartCrosshairOptions>,
    private legend: Required<ChartLegendOptions>,
    private font: Required<ChartFontOptions>,
    private priceAxisWidth: number,
  ) {}

  private axisFont(): string {
    return `${this.font.axisSize}px ${this.font.family}`;
  }

  private legendFont(): string {
    return `${this.font.legendSize}px ${this.font.family}`;
  }

  render(input: CrosshairRenderInput): void {
    const {
      x,
      timeSeconds,
      hoverY,
      valueMin,
      valueMax,
      priceStep,
      chartWidth,
      chartHeight,
      stackHeight,
      invertValueAxis,
      legendParts,
      canvasWidth,
    } = input;
    const { ctx, crosshair } = this;

    ctx.save();
    ctx.strokeStyle = crosshair.lineColor;
    ctx.setLineDash([4, 4]);

    // Spans the whole pane stack (not just the main pane's own
    // chartHeight) so hovering a candle lines up with the same column
    // across every indicator pane below it — see `stackHeight`'s own doc
    // comment for why the horizontal line/legend don't follow suit.
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, stackHeight);
    ctx.stroke();

    // The horizontal line follows the actual cursor/finger position, not
    // any property of the hovered point — pinning it to (say) the candle's
    // close would leave it motionless while the pointer moves anywhere
    // within that same candle's column, which reads as broken/stuck rather
    // than as a crosshair. Only drawn while the pointer is actually inside
    // the chart's vertical extent, same as AxisRenderer's tick-skip logic.
    const priceLineVisible = hoverY !== null && hoverY >= 0 && hoverY <= chartHeight;
    if (priceLineVisible) {
      ctx.beginPath();
      ctx.moveTo(0, hoverY);
      ctx.lineTo(chartWidth, hoverY);
      ctx.stroke();
    }
    ctx.restore();

    if (priceLineVisible) {
      // Exact inverse of the value->y mapping createScale set up for this
      // frame — same helper (and same invertValueAxis flag) as
      // PluginRenderApi.valueForY, see src/valueAxis.ts.
      const value = pixelToValue(hoverY, valueMin, valueMax, chartHeight, invertValueAxis);
      this.renderPriceLabelChip(formatPrice(value, priceStep), hoverY, chartWidth);
    }
    this.renderTimeLabelChip(formatHoverTime(timeSeconds), x, chartHeight, canvasWidth);

    if (legendParts.length === 0) return;
    this.renderHoverTooltip(legendParts, x, hoverY, chartWidth, chartHeight);
  }

  /** The OHLC(+volume) tooltip — floats near the hovered pixel like a
   * speech bubble, one line per part, rather than a fixed banner glued to
   * a corner of the canvas. Offset up-and-right of the cursor/finger by
   * `legend.cursorGap` and clamped to both chart edges so it never runs
   * off-screen, including when there's no `hoverY` to anchor to (a series
   * with no primary value still gets a legend, just pinned near the top
   * at the hovered column). */
  private renderHoverTooltip(
    lines: string[],
    x: number,
    hoverY: number | null,
    chartWidth: number,
    chartHeight: number,
  ): void {
    const { ctx, font, legend } = this;
    ctx.font = this.legendFont();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    const lineHeight = font.legendSize + 4;
    const textWidth = Math.max(...lines.map((line) => ctx.measureText(line).width));
    const boxWidth = textWidth + legend.paddingX * 2;
    const boxHeight = lines.length * lineHeight + legend.paddingY * 2;

    const anchorY = hoverY ?? 0;
    const left = Math.min(Math.max(x + legend.cursorGap, 0), Math.max(0, chartWidth - boxWidth));
    const top = Math.min(
      Math.max(anchorY - boxHeight - legend.cursorGap, 0),
      Math.max(0, chartHeight - boxHeight),
    );

    ctx.fillStyle = legend.background;
    ctx.fillRect(left, top, boxWidth, boxHeight);

    ctx.fillStyle = legend.textColor;
    lines.forEach((line, i) => {
      ctx.fillText(line, left + legend.paddingX, top + legend.paddingY + i * lineHeight);
    });
  }

  /** The highlighted price-axis label that follows the crosshair's
   * horizontal line — drawn over `AxisRenderer`'s own tick labels so the
   * hovered value reads clearly even where it lands between two ticks. */
  private renderPriceLabelChip(text: string, y: number, chartWidth: number): void {
    const { ctx, font, crosshair } = this;
    ctx.font = this.axisFont();
    const chipHeight = font.axisSize + crosshair.labelPaddingY * 2;

    ctx.fillStyle = crosshair.labelBackground;
    ctx.fillRect(chartWidth, y - chipHeight / 2, this.priceAxisWidth, chipHeight);

    ctx.fillStyle = crosshair.labelTextColor;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, chartWidth + crosshair.labelPaddingX, y);
  }

  /** The highlighted time-axis label under the crosshair's vertical line.
   * Clamped so its background chip stays fully on-screen even when the
   * hovered point sits at the very first or last visible index. */
  private renderTimeLabelChip(text: string, x: number, chartHeight: number, canvasWidth: number): void {
    const { ctx, font, crosshair } = this;
    ctx.font = this.axisFont();
    const chipWidth = ctx.measureText(text).width + crosshair.labelPaddingX * 2;
    const chipHeight = font.axisSize + crosshair.labelPaddingY * 2;
    const chipLeft = Math.min(Math.max(x - chipWidth / 2, 0), canvasWidth - chipWidth);

    ctx.fillStyle = crosshair.labelBackground;
    ctx.fillRect(chipLeft, chartHeight, chipWidth, chipHeight);

    ctx.fillStyle = crosshair.labelTextColor;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(text, chipLeft + crosshair.labelPaddingX, chartHeight + crosshair.labelPaddingY);
  }
}
