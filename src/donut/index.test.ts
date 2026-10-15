// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestCanvas } from '../testHelpers';
import { createDonutChart } from './index';
import type { DonutOptions } from './index';

// 200x200 canvas at ratio 1, default options: padding = 6 (selected.grow) + 1
// (half the 2px outline), so the ring spans r = 65.1..93 around (100, 100).
// Two equal slices: 'a' is the right half (0°-180°), 'b' the left.
const RIGHT = { clientX: 170, clientY: 100 };
const LEFT = { clientX: 30, clientY: 100 };
const HOLE = { clientX: 100, clientY: 100 };
const DATA = [
  { key: 'a', label: 'Alpha', value: 1 },
  { key: 'b', label: 'Beta', value: 1 },
];

const charts: { destroy(): void }[] = [];

function setup(options?: DonutOptions, width = 200, cssWidth = width) {
  const { canvas, ctx } = createTestCanvas(width, width, cssWidth, cssWidth);
  const chart = createDonutChart(canvas, options).setData(DATA);
  charts.push(chart);
  return { canvas, ctx, chart };
}

function fire(canvas: HTMLCanvasElement, type: string, point: { clientX: number; clientY: number }, pointerType?: string) {
  const event = new MouseEvent(type, point);
  if (pointerType) Object.defineProperty(event, 'pointerType', { value: pointerType });
  canvas.dispatchEvent(event);
}

afterEach(() => {
  // Destroy first: it cancels pending frames that would otherwise render
  // after restoreAllMocks() has un-stubbed getContext.
  charts.splice(0).forEach((chart) => chart.destroy());
  vi.restoreAllMocks();
});

describe('DonutChart data and a11y', () => {
  it('lays out arcs and reports the center in CSS px', () => {
    const { chart } = setup(undefined, 400, 200); // ratio 2
    expect(chart.getArcs().map((a) => a.key)).toEqual(['a', 'b']);
    expect(chart.getCenter()).toEqual({ x: 100, y: 100, innerRadius: expect.closeTo(0.7 * (200 - 7 * 2) / 2 / 1, 0) });
  });

  it('sets role/aria-label from the arcs, refreshes on setData, and removes them on destroy', () => {
    const { canvas, chart } = setup();
    expect(canvas.getAttribute('role')).toBe('img');
    expect(canvas.getAttribute('aria-label')).toBe('Alpha 50.0%, Beta 50.0%');
    chart.setData([{ key: 'a', label: 'Alpha', value: 3 }, { key: 'b', label: 'Beta', value: 1 }]);
    expect(canvas.getAttribute('aria-label')).toBe('Alpha 75.0%, Beta 25.0%');
    chart.setOptions({ formatPercent: (f) => `${Math.round(f * 100)}%` });
    expect(canvas.getAttribute('aria-label')).toBe('Alpha 75%, Beta 25%');
    chart.destroy();
    expect(canvas.hasAttribute('role')).toBe(false);
    expect(canvas.hasAttribute('aria-label')).toBe(false);
  });

  it('leaves the canvas attributes alone with a11y: false', () => {
    const { canvas } = setup({ a11y: false });
    expect(canvas.hasAttribute('role')).toBe(false);
    expect(canvas.hasAttribute('aria-label')).toBe(false);
  });

  it('warns on a duplicate key', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { chart } = setup();
    chart.setData([DATA[0]!, DATA[0]!]);
    expect(warn).toHaveBeenCalledOnce();
  });
});

describe('DonutChart pointer interaction', () => {
  it('fires onHover on change only, and null on leave', () => {
    const onHover = vi.fn();
    const { canvas, chart } = setup({ onHover });
    fire(canvas, 'pointermove', RIGHT);
    fire(canvas, 'pointermove', { clientX: 175, clientY: 105 }); // still 'a'
    expect(onHover).toHaveBeenCalledTimes(1);
    expect(onHover.mock.calls[0]![0]).toMatchObject({ arc: { key: 'a' }, source: 'pointer' });
    expect(chart.getHighlight()).toBe('a');

    fire(canvas, 'pointermove', LEFT);
    expect(onHover.mock.calls[1]![0].arc.key).toBe('b');
    fire(canvas, 'pointerleave', LEFT);
    expect(onHover.mock.calls[2]![0]).toEqual({ arc: null, source: 'pointer' });
    expect(chart.getHighlight()).toBeNull();
  });

  it('ignores the hole, and touch pointermoves (no hover on touch)', () => {
    const onHover = vi.fn();
    const { canvas } = setup({ onHover });
    fire(canvas, 'pointermove', HOLE);
    fire(canvas, 'pointermove', RIGHT, 'touch');
    expect(onHover).not.toHaveBeenCalled();
  });

  it('leaving does not clear a highlight that came from the API, and API calls never fire callbacks', () => {
    const onHover = vi.fn();
    const onSelect = vi.fn();
    const { canvas, chart } = setup({ onHover, onSelect });
    chart.setHighlight('b').setSelected('a');
    fire(canvas, 'pointerleave', LEFT);
    expect(chart.getHighlight()).toBe('b');
    expect(chart.getSelected()).toBe('a');
    expect(onHover).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('selects on click, toggles off on a second click, and clears on empty space', () => {
    const onSelect = vi.fn();
    const { canvas, chart } = setup({ onSelect });
    fire(canvas, 'click', RIGHT);
    expect(chart.getSelected()).toBe('a');
    expect(onSelect.mock.calls[0]![0]).toMatchObject({ arc: { key: 'a' }, source: 'pointer' });

    fire(canvas, 'click', LEFT);
    expect(chart.getSelected()).toBe('b');
    fire(canvas, 'click', LEFT);
    expect(chart.getSelected()).toBeNull();
    expect(onSelect.mock.calls[2]![0].arc).toBeNull();

    fire(canvas, 'click', RIGHT);
    fire(canvas, 'click', HOLE);
    expect(chart.getSelected()).toBeNull();
    expect(onSelect).toHaveBeenCalledTimes(5); // a, b, off, a, off
  });

  it('does not report a selection change when nothing was selected and empty space is clicked', () => {
    const onSelect = vi.fn();
    const { canvas } = setup({ onSelect });
    fire(canvas, 'click', HOLE);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('drops a highlight/selection whose slice no longer exists', () => {
    const { chart } = setup();
    chart.setHighlight('a').setSelected('b');
    chart.setData([{ key: 'z', label: 'Zed', value: 1 }]);
    expect(chart.getHighlight()).toBeNull();
    expect(chart.getSelected()).toBeNull();
  });
});

describe('DonutChart rendering', () => {
  it('draws label, value and percent in a tooltip while a slice is hovered by mouse', () => {
    const { canvas, ctx, chart } = setup();
    chart.render();
    expect(ctx.fillText).not.toHaveBeenCalled();

    fire(canvas, 'pointermove', RIGHT);
    chart.render();
    const texts = ctx.fillText.mock.calls.map((c) => c[0]);
    expect(texts).toEqual(['● ', 'Alpha', '1 · 50.0%']);
  });

  it('pins the tooltip on a touch tap and clears it when the selection is cleared', () => {
    const { canvas, ctx, chart } = setup();
    fire(canvas, 'pointerdown', RIGHT, 'touch');
    fire(canvas, 'click', RIGHT);
    fire(canvas, 'pointerleave', RIGHT, 'touch'); // fires after every tap; must not clear it
    chart.render();
    expect(ctx.fillText).toHaveBeenCalled();

    ctx.fillText.mockClear();
    fire(canvas, 'pointerdown', RIGHT, 'touch');
    fire(canvas, 'click', RIGHT); // second tap deselects
    chart.render();
    expect(ctx.fillText).not.toHaveBeenCalled();
  });

  it('uses formatLegend and suppresses the tooltip for []', () => {
    const { canvas, ctx, chart } = setup({
      formatLegend: (arc, c) => [`${arc.segment.label}: ${c.formatPercent(arc.fraction)} (#${c.index})`],
    });
    fire(canvas, 'pointermove', LEFT);
    chart.render();
    expect(ctx.fillText.mock.calls.map((c) => c[0])).toEqual(['Beta: 50.0% (#1)']);

    ctx.fillText.mockClear();
    chart.setOptions({ formatLegend: () => [] });
    chart.render();
    expect(ctx.fillText).not.toHaveBeenCalled();
  });

  it('paints a full ring for one slice, grows the emphasized slice, and calls centerRenderer', () => {
    const centerRenderer = vi.fn();
    const { ctx, chart } = setup({ centerRenderer, hover: { grow: 10 } });
    chart.setData([{ key: 'only', label: 'Only', value: 5 }]).setHighlight('only');
    chart.render();
    // track + one slice, each an outer arc then an inner arc
    const outerRadii = ctx.arc.mock.calls.filter((_, i) => i % 2 === 0).map((c) => c[2]);
    expect(outerRadii).toEqual([89, 99]); // 100 - (grow 10 + 1 outline) padding; the highlighted slice grows by 10
    expect(centerRenderer).toHaveBeenCalledOnce();
    expect(centerRenderer.mock.calls[0]![1]).toMatchObject({ cx: 100, cy: 100, devicePixelRatio: 1 });
  });

  it('draws nothing but the track for empty data', () => {
    const { ctx, chart } = setup();
    chart.setData([]).render();
    expect(ctx.arc).toHaveBeenCalledTimes(2);
  });

  it('cancels a pending frame on destroy', () => {
    const cancel = vi.spyOn(window, 'cancelAnimationFrame');
    const { chart } = setup();
    chart.setHighlight('a');
    chart.destroy();
    expect(cancel).toHaveBeenCalled();
  });
});
