import { formatAxisLabel, pickTickIndices } from './axis.js';
import { formatPrice, niceTicks } from './priceAxis.js';
import type { Scale } from './hybridScale.js';
import type { ChartAxisOptions, ChartFontOptions } from './types.js';

/**
 * Draws the price/time axis chrome — boundary lines, grid lines, tick
 * labels, and the separator between stacked panes. Split out of
 * `ChartRenderer` because none of it needs anything beyond already-resolved
 * style options and per-call geometry (a `Scale`, a pixel rect): no
 * series-specific, plugin-specific, or pane-identity state crosses into
 * this class — `ChartRenderer.render()` still owns deciding *what* to draw
 * where (the main pane vs. each indicator pane, in what order), this only
 * owns *how* one axis actually gets drawn once told where.
 */
export class AxisRenderer {
  constructor(
    private ctx: CanvasRenderingContext2D,
    private axis: Required<ChartAxisOptions>,
    private font: Required<ChartFontOptions>,
  ) {}

  private axisFont(): string {
    return `${this.font.axisSize}px ${this.font.family}`;
  }

  /** The decimal precision `formatPrice` should use for a given value
   * range — shared by this class's own tick labels and
   * `CrosshairRenderer`'s price label so both display the same value with
   * the same rounding. */
  priceStep(min: number, max: number): number {
    const ticks = niceTicks(min, max, this.axis.priceTickCount);
    return ticks.length > 1 ? ticks[1]! - ticks[0]! : 0;
  }

  /**
   * Draws one pane's right-side value axis: boundary line, horizontal grid
   * lines, and tick labels. Used for both the main price pane and every
   * indicator pane — `topOffset` shifts everything down by that pane's own
   * position in the stack (0 for the main pane, which sits at the top), so
   * `yScale` only ever has to know about its own pane-local [0, chartHeight]
   * range and never about where that pane lives in the full canvas.
   */
  renderPriceAxis(
    priceMin: number,
    priceMax: number,
    step: number,
    yScale: Scale,
    chartWidth: number,
    chartHeight: number,
    topOffset: number,
  ): void {
    const { ctx, axis } = this;
    const ticks = niceTicks(priceMin, priceMax, axis.priceTickCount);

    ctx.strokeStyle = axis.lineColor;
    ctx.beginPath();
    ctx.moveTo(chartWidth + 0.5, topOffset);
    ctx.lineTo(chartWidth + 0.5, topOffset + chartHeight);
    ctx.stroke();

    ctx.font = this.axisFont();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    for (const value of ticks) {
      const localY = yScale.map(value);
      if (localY < 0 || localY > chartHeight) continue;
      const y = topOffset + localY;

      ctx.strokeStyle = axis.gridLineColor;
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(chartWidth, y + 0.5);
      ctx.stroke();

      ctx.fillStyle = axis.textColor;
      ctx.fillText(formatPrice(value, step), chartWidth + 6, y);
    }
  }

  /** The horizontal rule separating an indicator pane from whatever sits
   * above it (the main pane, or the previous indicator pane) — the same
   * `axis.lineColor` boundary style `renderTimeAxis` already draws between
   * the plotting area and the time-axis strip. */
  renderPaneSeparator(top: number, chartWidth: number): void {
    const { ctx, axis } = this;
    ctx.strokeStyle = axis.lineColor;
    ctx.beginPath();
    ctx.moveTo(0, top + 0.5);
    ctx.lineTo(chartWidth, top + 0.5);
    ctx.stroke();
  }

  renderTimeAxis(
    times: number[],
    startIdx: number,
    visibleCount: number,
    chartHeight: number,
    chartWidth: number,
    xForIndex: (globalIndex: number) => number,
  ): void {
    const { ctx, axis } = this;
    const visibleTimes = times.slice(startIdx, startIdx + visibleCount);
    const spanSeconds = visibleTimes[visibleTimes.length - 1]! - visibleTimes[0]!;

    ctx.strokeStyle = axis.lineColor;
    ctx.beginPath();
    ctx.moveTo(0, chartHeight + 0.5);
    ctx.lineTo(chartWidth, chartHeight + 0.5);
    ctx.stroke();

    ctx.fillStyle = axis.textColor;
    ctx.font = this.axisFont();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    for (const localIndex of pickTickIndices(visibleCount, axis.timeMaxTicks)) {
      const x = xForIndex(startIdx + localIndex);
      const label = formatAxisLabel(visibleTimes[localIndex]!, spanSeconds);
      ctx.fillText(label, x, chartHeight + 6);
    }
  }
}
