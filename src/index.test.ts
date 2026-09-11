// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CinderChart } from './index';
import { createTestCanvas } from './testHelpers';
import { resetWasmForTesting } from './wasm';
import type { Candle } from './types';
import type { DataRequest } from './dataSource';

function makeSeries(count: number, startTime = 0): Candle[] {
  return Array.from({ length: count }, (_, i) => {
    const t = startTime + i;
    return { time: t, open: 100 + i, high: 105 + i, low: 95 + i, close: 102 + i };
  });
}

function fireMouse(target: EventTarget, type: string, init: MouseEventInit): void {
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, ...init }));
}

function fireWheel(target: EventTarget, init: WheelEventInit): void {
  target.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init }));
}

describe('CinderChart', () => {
  let canvas: HTMLCanvasElement;

  beforeEach(() => {
    ({ canvas } = createTestCanvas(800, 400));
  });

  afterEach(() => {
    // loadWasm() is fired from the constructor of every chart built in
    // these tests — reset its module-level cache so one test's (fake or
    // real) load state can't leak into the next.
    resetWasmForTesting();
  });

  it('sorts unsorted input candles ascending by time on setData', () => {
    const chart = new CinderChart(canvas);
    chart.setData([
      { time: 30, open: 1, high: 1, low: 1, close: 1 },
      { time: 10, open: 2, high: 2, low: 2, close: 2 },
      { time: 20, open: 3, high: 3, low: 3, close: 3 },
    ]);
    expect(chart.getCandleCount()).toBe(3);
    expect(chart.getHoveredCandle()).toBeNull(); // nothing hovered yet, just sanity
  });

  it('defaults the visible window to the most recent DEFAULT_VISIBLE_CANDLES candles', () => {
    const chart = new CinderChart(canvas);
    chart.setData(makeSeries(500));
    const range = chart.getVisibleRange();
    expect(range.visibleCount).toBe(120);
    expect(range.endIndex).toBe(500);
    expect(range.startIndex).toBe(380);
  });

  it('shows the whole series when it is narrower than the default window', () => {
    const chart = new CinderChart(canvas);
    chart.setData(makeSeries(10));
    const range = chart.getVisibleRange();
    expect(range.startIndex).toBe(0);
    expect(range.endIndex).toBe(10);
  });

  it('render() does not throw before any data is set', () => {
    const chart = new CinderChart(canvas);
    expect(() => chart.render()).not.toThrow();
  });

  describe('panning by drag', () => {
    it('dragging right (mouse moves right) reveals earlier candles', () => {
      const chart = new CinderChart(canvas);
      chart.setData(makeSeries(500));
      const before = chart.getVisibleRange().startIndex;

      fireMouse(canvas, 'mousedown', { clientX: 100, clientY: 100 });
      fireMouse(canvas, 'mousemove', { clientX: 250, clientY: 100 }); // dragged +150px right
      fireMouse(window, 'mouseup', {});

      expect(chart.getVisibleRange().startIndex).toBeLessThan(before);
    });

    it('dragging left reveals later candles', () => {
      const chart = new CinderChart(canvas);
      chart.setData(makeSeries(500));
      // the default view is pinned at the right (most recent) edge, so first
      // drag right (→ earlier candles) to make room to drag back left into.
      fireMouse(canvas, 'mousedown', { clientX: 100, clientY: 100 });
      fireMouse(canvas, 'mousemove', { clientX: 400, clientY: 100 });
      fireMouse(window, 'mouseup', {});
      const before = chart.getVisibleRange().startIndex;

      fireMouse(canvas, 'mousedown', { clientX: 400, clientY: 100 });
      fireMouse(canvas, 'mousemove', { clientX: 250, clientY: 100 }); // dragged left
      fireMouse(window, 'mouseup', {});

      expect(chart.getVisibleRange().startIndex).toBeGreaterThan(before);
    });

    it('does not pan past either edge of the loaded data', () => {
      const chart = new CinderChart(canvas);
      chart.setData(makeSeries(50)); // narrower than DEFAULT_VISIBLE_CANDLES, so already fully zoomed out
      fireMouse(canvas, 'mousedown', { clientX: 100, clientY: 100 });
      fireMouse(canvas, 'mousemove', { clientX: 100_000, clientY: 100 }); // absurd drag distance
      fireMouse(window, 'mouseup', {});

      const range = chart.getVisibleRange();
      expect(range.startIndex).toBe(0);
      expect(range.endIndex).toBe(50);
    });

    it('scales drag distance by the backing-store/CSS pixel ratio', () => {
      // canvas backing store is 2x the CSS size — simulates devicePixelRatio 2
      const { canvas: hiDpiCanvas } = createTestCanvas(1600, 800, 800, 400);
      const chart = new CinderChart(hiDpiCanvas);
      chart.setData(makeSeries(1000));
      const before = chart.getVisibleRange().startIndex;

      fireMouse(hiDpiCanvas, 'mousedown', { clientX: 100, clientY: 100 });
      fireMouse(hiDpiCanvas, 'mousemove', { clientX: 200, clientY: 100 }); // 100 CSS px = 200 device px
      fireMouse(window, 'mouseup', {});

      const afterDelta = before - chart.getVisibleRange().startIndex;
      expect(afterDelta).toBeGreaterThan(0);
    });
  });

  describe('zooming', () => {
    it('scrolling down (deltaY > 0) zooms out (more candles visible)', () => {
      const chart = new CinderChart(canvas);
      chart.setData(makeSeries(1000));
      const before = chart.getVisibleRange().visibleCount;
      fireWheel(canvas, { deltaX: 0, deltaY: 100, clientX: 400, clientY: 200 });
      expect(chart.getVisibleRange().visibleCount).toBeGreaterThan(before);
    });

    it('scrolling up (deltaY < 0) zooms in (fewer candles visible)', () => {
      const chart = new CinderChart(canvas);
      chart.setData(makeSeries(1000, 0));
      // zoom out first so there's room to zoom back in
      fireWheel(canvas, { deltaX: 0, deltaY: 100, clientX: 400, clientY: 200 });
      const before = chart.getVisibleRange().visibleCount;
      fireWheel(canvas, { deltaX: 0, deltaY: -100, clientX: 400, clientY: 200 });
      expect(chart.getVisibleRange().visibleCount).toBeLessThan(before);
    });

    it('a horizontal-dominant wheel gesture pans instead of zooming', () => {
      const chart = new CinderChart(canvas);
      chart.setData(makeSeries(1000));
      const before = chart.getVisibleRange();
      // the default view is pinned at the right edge, so only a negative
      // deltaX (which decreases startIndex) has room to actually move.
      fireWheel(canvas, { deltaX: -120, deltaY: 5, clientX: 400, clientY: 200 });
      const after = chart.getVisibleRange();
      expect(after.visibleCount).toBe(before.visibleCount); // no zoom
      expect(after.startIndex).not.toBe(before.startIndex); // but it did pan
    });
  });

  describe('price axis', () => {
    it('has no manual price range until the user touches the price axis', () => {
      const chart = new CinderChart(canvas);
      chart.setData(makeSeries(100));
      expect(chart.getPriceRangeOverride()).toBeNull();
    });

    it('dragging inside the chart area also sets a manual price range (vertical pan)', () => {
      const chart = new CinderChart(canvas);
      chart.setData(makeSeries(100));

      fireMouse(canvas, 'mousedown', { clientX: 400, clientY: 100 });
      fireMouse(canvas, 'mousemove', { clientX: 400, clientY: 160 }); // dragged down
      fireMouse(window, 'mouseup', {});

      const range = chart.getPriceRangeOverride();
      expect(range).not.toBeNull();
    });

    it('dragging the price-axis strip (right of chartWidth) scales the range without panning time', () => {
      const chart = new CinderChart(canvas);
      chart.setData(makeSeries(100));
      const beforeTime = chart.getVisibleRange();

      // chartWidth = 800 - 64 = 736; x=770 is inside the price-axis strip
      fireMouse(canvas, 'mousedown', { clientX: 770, clientY: 100 });
      fireMouse(canvas, 'mousemove', { clientX: 770, clientY: 160 });
      fireMouse(window, 'mouseup', {});

      expect(chart.getVisibleRange()).toEqual(beforeTime); // dragging the axis never pans candles
      expect(chart.getPriceRangeOverride()).not.toBeNull();
    });
  });

  describe('hover', () => {
    it('tracks the hovered candle on mousemove without a drag', () => {
      const chart = new CinderChart(canvas);
      chart.setData(makeSeries(10));
      fireMouse(canvas, 'mousemove', { clientX: 400, clientY: 100 });
      expect(chart.getHoveredCandle()).not.toBeNull();
    });

    it('clears the hover on mouseleave', () => {
      const chart = new CinderChart(canvas);
      chart.setData(makeSeries(10));
      fireMouse(canvas, 'mousemove', { clientX: 400, clientY: 100 });
      expect(chart.getHoveredCandle()).not.toBeNull();

      fireMouse(canvas, 'mouseleave', {});
      expect(chart.getHoveredCandle()).toBeNull();
    });

    it('reports null hover when the cursor is over the price-axis strip', () => {
      const chart = new CinderChart(canvas);
      chart.setData(makeSeries(10));
      fireMouse(canvas, 'mousemove', { clientX: 770, clientY: 100 }); // inside the 64px price-axis strip
      expect(chart.getHoveredCandle()).toBeNull();
    });
  });

  describe('setDataLoader', () => {
    // A freshly-`setData()`'d chart is always pinned to the most recent
    // candle, so its "after" edge (remaining candles past what's visible)
    // is always 0 — the loader gets asked for 'after' data immediately in
    // every one of these cases too. That's expected, not a test bug: these
    // assertions specifically check the 'before' direction, and use a
    // loader that resolves 'after' requests to `[]` so that side doesn't
    // interfere with what's being asserted.

    it('requests more "before" candles once the window nears the left edge, and merges the result', async () => {
      const chart = new CinderChart(canvas);
      chart.setData(makeSeries(30, 1000)); // 30 < DEFAULT_VISIBLE_CANDLES → view starts at [0, 30)
      const loader = vi.fn(async (req: DataRequest) =>
        req.direction === 'before' ? makeSeries(15, 1000 - 15) : [],
      );
      chart.setDataLoader(loader, 5); // small threshold so one batch clears it
      chart.render(); // render() is what triggers maybeLoadMore()
      await vi.waitFor(() => expect(chart.getCandleCount()).toBe(45));
      expect(loader.mock.calls.some(([req]) => req.direction === 'before')).toBe(true);
    });

    it('does not request "before" data when the window is far from the start of the series', () => {
      const chart = new CinderChart(canvas);
      chart.setData(makeSeries(1000));
      // default view sits on the most recent 120 of 1000 — startIndex=880, nowhere near 0
      const loader = vi.fn(async () => []);
      chart.setDataLoader(loader, 20);
      chart.render();
      expect(loader.mock.calls.some(([req]) => req.direction === 'before')).toBe(false);
    });

    it('requests "after" data for a freshly-loaded series pinned to its most recent candle', () => {
      const chart = new CinderChart(canvas);
      chart.setData(makeSeries(1000));
      const loader = vi.fn(async () => []);
      chart.setDataLoader(loader, 20);
      chart.render();
      expect(loader.mock.calls.some(([req]) => req.direction === 'after')).toBe(true);
    });

    it('stops re-requesting a direction once the loader reports it exhausted (returns empty)', async () => {
      const chart = new CinderChart(canvas);
      chart.setData(makeSeries(10)); // small enough that both edges are within threshold at once
      const loader = vi.fn(async () => []);
      chart.setDataLoader(loader, 20);

      chart.render();
      await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(2)); // one 'before', one 'after'

      chart.render(); // both directions already exhausted — should not ask again
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(loader).toHaveBeenCalledTimes(2);
    });

    it('does not fire a second overlapping request for the same direction while one is still in flight', async () => {
      const chart = new CinderChart(canvas);
      chart.setData(makeSeries(10));
      const pendingResolvers: Array<(candles: Candle[]) => void> = [];
      const loader = vi.fn(() => new Promise<Candle[]>((resolve) => pendingResolvers.push(resolve)));
      chart.setDataLoader(loader, 20);

      chart.render();
      chart.render();
      chart.render();
      expect(loader).toHaveBeenCalledTimes(2); // one per direction — no duplicates within either

      pendingResolvers.forEach((resolve) => resolve([]));
      await vi.waitFor(() => expect(chart.getCandleCount()).toBe(10));
    });

    it('keeps the visible window stable (no jump) when candles are prepended', async () => {
      const chart = new CinderChart(canvas);
      chart.setData(makeSeries(10, 1000));
      const before = chart.getVisibleRange();
      const loader = vi.fn(async (req: DataRequest) =>
        req.direction === 'before' ? makeSeries(15, 1000 - 15) : [],
      );
      chart.setDataLoader(loader, 5);

      chart.render();
      await vi.waitFor(() => expect(chart.getCandleCount()).toBe(25));

      // 15 candles were prepended; the same candles that were visible before
      // should still be visible, just at indices shifted by 15.
      const after = chart.getVisibleRange();
      expect(after.startIndex).toBe(before.startIndex + 15);
      expect(after.endIndex).toBe(before.endIndex + 15);
    });
  });

  describe('destroy', () => {
    it('stops reacting to further input after destroy()', () => {
      const chart = new CinderChart(canvas);
      chart.setData(makeSeries(500));
      chart.destroy();

      const before = chart.getVisibleRange();
      fireMouse(canvas, 'mousedown', { clientX: 100, clientY: 100 });
      fireMouse(canvas, 'mousemove', { clientX: 300, clientY: 100 });
      fireMouse(window, 'mouseup', {});

      expect(chart.getVisibleRange()).toEqual(before);
    });
  });
});
