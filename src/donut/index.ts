import { devicePixelRatio } from '../devicePixelRatio.js';
import { drawLegendBox } from '../legendBox.js';
import { drawDonut } from './draw.js';
import { computeDonutArcs, computeDonutGeometry, donutAriaLabel, hitTestArc } from './layout.js';
import type { ChartFontOptions, ChartLegendOptions, LegendLine } from '../types.js';
import type { DonutArc, DonutGeometry, DonutSegment } from './layout.js';

export { DEFAULT_PALETTE, computeDonutArcs, computeDonutGeometry, hitTestArc } from './layout.js';
export type { DonutArc, DonutGeometry, DonutSegment } from './layout.js';

/** Hover emphasis — `hover: false` (the default) turns it off entirely. */
export interface DonutHoverOptions {
  /** How far, in CSS px, the hovered slice's outer edge pushes out. Defaults to 4. */
  grow?: number;
  /** Opacity (`0..1`) of every other slice while one is hovered. Defaults to 0.4. */
  dim?: number;
}

/** How the selected slice looks. Selection is always available (click/tap
 * or `setSelected`); this only styles it. */
export interface DonutSelectedOptions {
  /** Outer-edge push-out, in CSS px. Defaults to 6. */
  grow?: number;
  /** Defaults to `'#f0f0f0'`. */
  outlineColor?: string;
  /** In CSS px; 0 disables the outline. Defaults to 2. */
  outlineWidth?: number;
}

/** Passed to `DonutOptions.formatLegend` alongside the hovered arc —
 * `index` and `arcs` mirror `LegendFormatContext`'s index/allPoints, and the
 * two formatters are the chart's resolved ones, so a custom legend can stay
 * consistent with them. */
export interface DonutLegendContext<TDatum = unknown> {
  index: number;
  arcs: readonly DonutArc<TDatum>[];
  formatValue(value: number): string;
  formatPercent(fraction: number): string;
}

/** What a pointer interaction reports. `arc` is `null` when the pointer left
 * every slice (hover) or the selection was cleared (select). `source` is
 * `'pointer'` today and may gain members (e.g. keyboard) — don't switch on it
 * exhaustively. API calls (`setHighlight`/`setSelected`) never fire callbacks,
 * so a controlled wrapper can't loop through them. */
export interface DonutEvent<TDatum = unknown> {
  arc: DonutArc<TDatum> | null;
  source: 'pointer';
}

export interface DonutOptions<TDatum = unknown> {
  /** Canvas background. Defaults to transparent. */
  background?: string;
  /** Colors for segments without their own, by position. */
  palette?: readonly string[];
  /** Hole radius as a fraction of the outer radius, `0..1`; `0` is a full
   * pie. Defaults to 0.7. */
  innerRadius?: number;
  /** Where the first slice starts, in degrees clockwise from 12 o'clock.
   * Defaults to 0. */
  startAngle?: number;
  /** Total angle the slices span, `1..360`. Below 360 makes a gauge — e.g.
   * `startAngle: -90, sweep: 180` is an upper half-ring. Defaults to 360. */
  sweep?: number;
  /** Seam between slices, in CSS px at the ring's mid radius. Defaults to 2. */
  gap?: number;
  /** Fill of the ring behind the slices (visible in a gauge's remainder). */
  trackColor?: string;
  hover?: false | DonutHoverOptions;
  selected?: DonutSelectedOptions;
  font?: ChartFontOptions;
  /** Hover tooltip styling — the same `ChartLegendOptions` the crosshair
   * legend takes. */
  legend?: ChartLegendOptions;
  /** Text of the hover tooltip, one `LegendLine` per row. Defaults to the
   * label (with a color dot) over `value · percent`. Return `[]` to
   * suppress it. */
  formatLegend?(arc: DonutArc<TDatum>, context: DonutLegendContext<TDatum>): LegendLine[];
  /** Defaults to `toLocaleString('en-US')`. */
  formatValue?(value: number): string;
  /** Takes a `0..1` fraction. Defaults to one decimal, e.g. `'12.3%'`. */
  formatPercent?(fraction: number): string;
  /** Draws into the hole (or anywhere) after the ring, before the tooltip.
   * `geometry` and `ctx` are in backing-store pixels; multiply CSS-px sizes
   * by `devicePixelRatio`. For DOM content use `getCenter()` instead. */
  centerRenderer?(ctx: CanvasRenderingContext2D, geometry: DonutGeometry & { devicePixelRatio: number }): void;
  onHover?(event: DonutEvent<TDatum>): void;
  onSelect?(event: DonutEvent<TDatum>): void;
  /** Set `role="img"` and an `aria-label` listing every slice's percent on
   * the canvas, kept current by `setData`/`setOptions`. Pass `false` to leave
   * the canvas's attributes alone. Defaults to true. */
  a11y?: boolean;
}

const DEFAULT_FONT: Required<ChartFontOptions> = { family: 'sans-serif', axisSize: 10, legendSize: 11 };
const DEFAULT_LEGEND: Required<ChartLegendOptions> = {
  textColor: '#f0f0f0',
  background: '#3a3a3a',
  paddingX: 8,
  paddingY: 6,
  cursorGap: 12,
};
const DEFAULT_HOVER: Required<DonutHoverOptions> = { grow: 4, dim: 0.4 };
const DEFAULT_SELECTED: Required<DonutSelectedOptions> = { grow: 6, outlineColor: '#f0f0f0', outlineWidth: 2 };

const defaultFormatValue = (value: number): string => value.toLocaleString('en-US');
const defaultFormatPercent = (fraction: number): string => `${(fraction * 100).toFixed(1)}%`;

/**
 * A donut/pie/gauge chart on a `<canvas>`. Layout is pure (see
 * `./layout.ts`); this class owns the state (highlight, selection, the
 * tooltip), pointer handling, and render scheduling. Construct once per
 * canvas, call `setData` + `render()`, and `destroy()` on unmount. Like
 * `WickChart`, it doesn't watch the canvas's size — resize the backing store,
 * then call `render()`.
 */
export class DonutChart<TDatum = unknown> {
  private options: DonutOptions<TDatum>;
  private segments: readonly DonutSegment<TDatum>[] = [];
  private arcs: DonutArc<TDatum>[] = [];
  private highlightKey: string | null = null;
  /** True while `highlightKey` was set by the pointer — only then does
   * leaving the canvas clear it (an API-set highlight is the caller's). */
  private highlightFromPointer = false;
  private selectedKey: string | null = null;
  /** Backing-store px; set by mouse hover or a touch selection. */
  private tooltip: { key: string; x: number; y: number } | null = null;
  private lastPointerType = 'mouse';
  private renderScheduled = false;
  private pendingAnimationFrame: number | null = null;
  private ariaManaged = false;

  constructor(
    private canvas: HTMLCanvasElement,
    options: DonutOptions<TDatum> = {},
  ) {
    this.options = options;
    // No `touch-action` change on purpose: unlike WickChart, nothing here
    // pans/zooms, so the page must stay scrollable under a finger.
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerleave', this.onPointerLeave);
    canvas.addEventListener('pointercancel', this.onPointerLeave);
    canvas.addEventListener('click', this.onClick);
    this.relayout();
  }

  /** Replaces the data. Zero/negative/non-finite values are skipped, and a
   * repeated `key` logs a warning (highlight/select address slices by key). */
  setData(segments: readonly DonutSegment<TDatum>[]): this {
    const keys = new Set<string>();
    for (const s of segments) {
      if (keys.has(s.key)) console.warn(`wick-charts: duplicate donut segment key "${s.key}"`);
      keys.add(s.key);
    }
    this.segments = segments;
    this.relayout();
    this.scheduleRender();
    return this;
  }

  /** Shallow-merges `options` over the current ones — a nested object
   * (`hover`, `selected`, `legend`, `font`) is replaced as a whole. */
  setOptions(options: DonutOptions<TDatum>): this {
    this.options = { ...this.options, ...options };
    this.relayout();
    this.scheduleRender();
    return this;
  }

  /** Programmatic hover emphasis (e.g. from a DOM legend). Does not fire
   * `onHover`. `null` clears it. */
  setHighlight(key: string | null): this {
    this.highlightKey = key;
    this.highlightFromPointer = false;
    this.scheduleRender();
    return this;
  }

  /** Programmatic selection. Does not fire `onSelect`. `null` clears it. */
  setSelected(key: string | null): this {
    this.selectedKey = key;
    this.tooltip = null;
    this.scheduleRender();
    return this;
  }

  getHighlight(): string | null {
    return this.arcs.some((a) => a.key === this.highlightKey) ? this.highlightKey : null;
  }

  getSelected(): string | null {
    return this.arcs.some((a) => a.key === this.selectedKey) ? this.selectedKey : null;
  }

  /** The laid-out slices — label, value, `fraction`, resolved `color` — for
   * drawing your own legend or table. */
  getArcs(): readonly DonutArc<TDatum>[] {
    return this.arcs;
  }

  /** The ring's center and hole radius in **CSS px** relative to the
   * canvas's top-left — what to position a DOM overlay against. */
  getCenter(): { x: number; y: number; innerRadius: number } {
    const g = this.geometry();
    const ratio = devicePixelRatio(this.canvas, 'width');
    return { x: g.cx / ratio, y: g.cy / ratio, innerRadius: g.innerRadius / ratio };
  }

  render(): void {
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('wick-charts: could not get a 2D context from the canvas');
    const { canvas, options } = this;
    const ratio = devicePixelRatio(canvas, 'width');
    const geometry = this.geometry();

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (options.background) {
      ctx.fillStyle = options.background;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    const hover = options.hover === undefined || options.hover === false ? null : { ...DEFAULT_HOVER, ...options.hover };
    const selected = { ...DEFAULT_SELECTED, ...options.selected };
    drawDonut(
      ctx,
      this.arcs,
      geometry,
      {
        trackColor: options.trackColor ?? 'rgba(128, 128, 128, 0.15)',
        gap: (options.gap ?? 2) * ratio,
        hover: hover && { grow: hover.grow * ratio, dim: hover.dim },
        selected: { ...selected, grow: selected.grow * ratio, outlineWidth: selected.outlineWidth * ratio },
      },
      { highlightKey: this.getHighlight(), selectedKey: this.getSelected() },
    );

    if (options.centerRenderer) {
      ctx.save();
      options.centerRenderer(ctx, { ...geometry, devicePixelRatio: ratio });
      ctx.restore();
    }
    this.renderTooltip(ctx, ratio);
  }

  /** Removes listeners, cancels a pending frame, and takes back the ARIA
   * attributes this chart set. Call on unmount. */
  destroy(): void {
    if (this.pendingAnimationFrame !== null) {
      cancelAnimationFrame(this.pendingAnimationFrame);
      this.pendingAnimationFrame = null;
    }
    const { canvas } = this;
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    canvas.removeEventListener('pointermove', this.onPointerMove);
    canvas.removeEventListener('pointerleave', this.onPointerLeave);
    canvas.removeEventListener('pointercancel', this.onPointerLeave);
    canvas.removeEventListener('click', this.onClick);
    if (this.ariaManaged) {
      canvas.removeAttribute('role');
      canvas.removeAttribute('aria-label');
      this.ariaManaged = false;
    }
  }

  /** Recomputes arcs from the data + shape options and refreshes the aria label. */
  private relayout(): void {
    const { palette, startAngle = 0, sweep = 360 } = this.options;
    this.arcs = computeDonutArcs(this.segments, { palette, startAngle, sweep: Math.min(Math.max(sweep, 1), 360) });
    if (this.options.a11y === false) return;
    this.ariaManaged = true;
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', donutAriaLabel(this.arcs, this.options.formatPercent ?? defaultFormatPercent));
  }

  private geometry(): DonutGeometry {
    const { canvas, options } = this;
    const ratio = devicePixelRatio(canvas, 'width');
    const hoverGrow = options.hover ? (options.hover.grow ?? DEFAULT_HOVER.grow) : 0;
    const selected = { ...DEFAULT_SELECTED, ...options.selected };
    // Room for the biggest push-out plus half the outline stroke.
    const padding = (Math.max(hoverGrow, selected.grow) + selected.outlineWidth / 2) * ratio;
    return computeDonutGeometry(canvas.width, canvas.height, {
      innerRatio: options.innerRadius ?? 0.7,
      padding,
      startAngle: options.startAngle ?? 0,
      sweep: Math.min(Math.max(options.sweep ?? 360, 1), 360),
    });
  }

  private renderTooltip(ctx: CanvasRenderingContext2D, ratio: number): void {
    const { tooltip, options } = this;
    const arc = tooltip && this.arcs.find((a) => a.key === tooltip.key);
    if (!tooltip || !arc) return;

    const formatValue = options.formatValue ?? defaultFormatValue;
    const formatPercent = options.formatPercent ?? defaultFormatPercent;
    const lines = options.formatLegend
      ? options.formatLegend(arc, { index: arc.index, arcs: this.arcs, formatValue, formatPercent })
      : [
          [{ text: '● ', color: arc.color }, { text: arc.segment.label }],
          `${formatValue(arc.value)} · ${formatPercent(arc.fraction)}`,
        ];
    if (lines.length === 0) return;

    const font = { ...DEFAULT_FONT, ...options.font };
    const legend = { ...DEFAULT_LEGEND, ...options.legend };
    drawLegendBox(
      ctx,
      lines,
      { x: tooltip.x, y: tooltip.y },
      { width: this.canvas.width, height: this.canvas.height },
      {
        ...legend,
        paddingX: legend.paddingX * ratio,
        paddingY: legend.paddingY * ratio,
        cursorGap: legend.cursorGap * ratio,
      },
      { ...font, legendSize: font.legendSize * ratio },
    );
  }

  /** Client coords to backing-store px — same conversion as `WickChart`. */
  private pointFromEvent(e: MouseEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * devicePixelRatio(this.canvas, 'width'),
      y: (e.clientY - rect.top) * devicePixelRatio(this.canvas, 'height'),
    };
  }

  private scheduleRender(): void {
    if (this.renderScheduled) return;
    this.renderScheduled = true;
    this.pendingAnimationFrame = requestAnimationFrame(() => {
      this.renderScheduled = false;
      this.pendingAnimationFrame = null;
      this.render();
    });
  }

  private onPointerDown = (e: PointerEvent): void => {
    // `click` doesn't say what produced it, so remember the pointer type
    // here — a touch tap pins the tooltip, a mouse click leaves it to hover.
    this.lastPointerType = e.pointerType || 'mouse';
  };

  private onPointerMove = (e: PointerEvent): void => {
    // Touch has no hover; a finger drag is the page scrolling.
    if ((e.pointerType || 'mouse') === 'touch') return;
    const { x, y } = this.pointFromEvent(e);
    const arc = hitTestArc(this.arcs, this.geometry(), x, y);
    const key = arc?.key ?? null;
    const changed = key !== this.highlightKey;
    this.highlightKey = key;
    this.highlightFromPointer = true;
    this.tooltip = arc ? { key: arc.key, x, y } : null;
    if (changed) this.options.onHover?.({ arc, source: 'pointer' });
    if (changed || arc) this.scheduleRender();
  };

  private onPointerLeave = (e: PointerEvent): void => {
    // A touch tap fires pointerleave right after pointerup; it must not
    // wipe the tooltip the tap just pinned.
    if ((e.pointerType || 'mouse') === 'touch' && e.type === 'pointerleave') return;
    this.tooltip = null;
    if (this.highlightFromPointer && this.highlightKey !== null) {
      this.highlightKey = null;
      this.highlightFromPointer = false;
      this.options.onHover?.({ arc: null, source: 'pointer' });
    }
    this.scheduleRender();
  };

  private onClick = (e: MouseEvent): void => {
    const { x, y } = this.pointFromEvent(e);
    const arc = hitTestArc(this.arcs, this.geometry(), x, y);
    // Clicking the selected slice again, or empty space, clears the selection.
    const next = arc && arc.key !== this.getSelected() ? arc : null;
    if ((next?.key ?? null) !== this.getSelected()) {
      this.selectedKey = next?.key ?? null;
      this.options.onSelect?.({ arc: next, source: 'pointer' });
    }
    if (this.lastPointerType === 'touch') this.tooltip = next ? { key: next.key, x, y } : null;
    this.scheduleRender();
  };
}

/** Creates a `DonutChart` on `canvas`. */
export function createDonutChart<TDatum = unknown>(
  canvas: HTMLCanvasElement,
  options?: DonutOptions<TDatum>,
): DonutChart<TDatum> {
  return new DonutChart<TDatum>(canvas, options);
}
