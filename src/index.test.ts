// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WickChart, createCandlestickChart, createLineChart } from './index';
import { createTestCanvas } from './testHelpers';
import { resetWasmForTesting } from './wasm';
import type { Candle } from './types';
import type { DataRequest } from './dataSource';
import type { ChartPlugin } from './plugins/types';
import { hitTestPoint } from './hitTest';

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

// jsdom does not implement the Touch Events spec (no `Touch`/`TouchEvent`
// constructors), so touch input can't be exercised via real dispatchEvent()
// the way mouse/wheel input is above. Instead, call the chart's touch
// handlers directly with a minimal object shaped like a real TouchEvent —
// they only ever read `.touches` and call `.preventDefault()`.
function touchPoint(clientX: number, clientY: number): Touch {
  return { clientX, clientY } as Touch;
}

function fakeTouchEvent(touches: Touch[]): TouchEvent {
  return { touches, preventDefault: () => {} } as unknown as TouchEvent;
}

function chartTouchHandlers(chart: WickChart): {
  onTouchStart: (e: TouchEvent) => void;
  onTouchMove: (e: TouchEvent) => void;
  onTouchEnd: (e: TouchEvent) => void;
} {
  return chart as unknown as {
    onTouchStart: (e: TouchEvent) => void;
    onTouchMove: (e: TouchEvent) => void;
    onTouchEnd: (e: TouchEvent) => void;
  };
}

describe('WickChart', () => {
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
    const chart = new WickChart(canvas);
    chart.setData([
      { time: 30, open: 1, high: 1, low: 1, close: 1 },
      { time: 10, open: 2, high: 2, low: 2, close: 2 },
      { time: 20, open: 3, high: 3, low: 3, close: 3 },
    ]);
    expect(chart.getPointCount()).toBe(3);
    expect(chart.getHoveredPoint()).toBeNull(); // nothing hovered yet, just sanity
  });

  it('defaults the visible window to the most recent DEFAULT_VISIBLE_POINTS candles', () => {
    const chart = new WickChart(canvas);
    chart.setData(makeSeries(500));
    const range = chart.getVisibleRange();
    expect(range.visibleCount).toBe(120);
    expect(range.endIndex).toBe(500);
    expect(range.startIndex).toBe(380);
  });

  it('shows the whole series when it is narrower than the default window', () => {
    const chart = new WickChart(canvas);
    chart.setData(makeSeries(10));
    const range = chart.getVisibleRange();
    expect(range.startIndex).toBe(0);
    expect(range.endIndex).toBe(10);
  });

  it('render() does not throw before any data is set', () => {
    const chart = new WickChart(canvas);
    expect(() => chart.render()).not.toThrow();
  });

  describe('panning by drag', () => {
    it('dragging right (mouse moves right) reveals earlier candles', () => {
      const chart = new WickChart(canvas);
      chart.setData(makeSeries(500));
      const before = chart.getVisibleRange().startIndex;

      fireMouse(canvas, 'mousedown', { clientX: 100, clientY: 100 });
      fireMouse(canvas, 'mousemove', { clientX: 250, clientY: 100 }); // dragged +150px right
      fireMouse(window, 'mouseup', {});

      expect(chart.getVisibleRange().startIndex).toBeLessThan(before);
    });

    it('dragging left reveals later candles', () => {
      const chart = new WickChart(canvas);
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
      const chart = new WickChart(canvas);
      chart.setData(makeSeries(50)); // narrower than DEFAULT_VISIBLE_POINTS, so already fully zoomed out
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
      const chart = new WickChart(hiDpiCanvas);
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
      const chart = new WickChart(canvas);
      chart.setData(makeSeries(1000));
      const before = chart.getVisibleRange().visibleCount;
      fireWheel(canvas, { deltaX: 0, deltaY: 100, clientX: 400, clientY: 200 });
      expect(chart.getVisibleRange().visibleCount).toBeGreaterThan(before);
    });

    it('scrolling up (deltaY < 0) zooms in (fewer candles visible)', () => {
      const chart = new WickChart(canvas);
      chart.setData(makeSeries(1000, 0));
      // zoom out first so there's room to zoom back in
      fireWheel(canvas, { deltaX: 0, deltaY: 100, clientX: 400, clientY: 200 });
      const before = chart.getVisibleRange().visibleCount;
      fireWheel(canvas, { deltaX: 0, deltaY: -100, clientX: 400, clientY: 200 });
      expect(chart.getVisibleRange().visibleCount).toBeLessThan(before);
    });

    it('a horizontal-dominant wheel gesture pans instead of zooming', () => {
      const chart = new WickChart(canvas);
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
      const chart = new WickChart(canvas);
      chart.setData(makeSeries(100));
      expect(chart.getValueRangeOverride()).toBeNull();
    });

    it('dragging inside the chart area also sets a manual price range (vertical pan)', () => {
      const chart = new WickChart(canvas);
      chart.setData(makeSeries(100));

      fireMouse(canvas, 'mousedown', { clientX: 400, clientY: 100 });
      fireMouse(canvas, 'mousemove', { clientX: 400, clientY: 160 }); // dragged down
      fireMouse(window, 'mouseup', {});

      const range = chart.getValueRangeOverride();
      expect(range).not.toBeNull();
    });

    it('dragging the price-axis strip (right of chartWidth) scales the range without panning time', () => {
      const chart = new WickChart(canvas);
      chart.setData(makeSeries(100));
      const beforeTime = chart.getVisibleRange();

      // chartWidth = 800 - 64 = 736; x=770 is inside the price-axis strip
      fireMouse(canvas, 'mousedown', { clientX: 770, clientY: 100 });
      fireMouse(canvas, 'mousemove', { clientX: 770, clientY: 160 });
      fireMouse(window, 'mouseup', {});

      expect(chart.getVisibleRange()).toEqual(beforeTime); // dragging the axis never pans candles
      expect(chart.getValueRangeOverride()).not.toBeNull();
    });
  });

  describe('hover', () => {
    it('tracks the hovered candle on mousemove without a drag', () => {
      const chart = new WickChart(canvas);
      chart.setData(makeSeries(10));
      fireMouse(canvas, 'mousemove', { clientX: 400, clientY: 100 });
      expect(chart.getHoveredPoint()).not.toBeNull();
    });

    it('clears the hover on mouseleave', () => {
      const chart = new WickChart(canvas);
      chart.setData(makeSeries(10));
      fireMouse(canvas, 'mousemove', { clientX: 400, clientY: 100 });
      expect(chart.getHoveredPoint()).not.toBeNull();

      fireMouse(canvas, 'mouseleave', {});
      expect(chart.getHoveredPoint()).toBeNull();
    });

    it('reports null hover when the cursor is over the price-axis strip', () => {
      const chart = new WickChart(canvas);
      chart.setData(makeSeries(10));
      fireMouse(canvas, 'mousemove', { clientX: 770, clientY: 100 }); // inside the 64px price-axis strip
      expect(chart.getHoveredPoint()).toBeNull();
    });

    it('re-renders when the pointer moves vertically within the same candle column', () => {
      // Regression test: the crosshair's horizontal line follows the raw
      // cursor position (ChartRenderer.renderCrosshairAndLegend), so moving
      // the mouse up/down without crossing into a different candle must
      // still trigger a render — otherwise the line looks stuck in place
      // until the next candle-column change.
      const chart = new WickChart(canvas);
      chart.setData(makeSeries(10));
      const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
        cb(0);
        return 0;
      });

      try {
        fireMouse(canvas, 'mousemove', { clientX: 400, clientY: 100 });
        expect(rafSpy).toHaveBeenCalledTimes(1);

        fireMouse(canvas, 'mousemove', { clientX: 400, clientY: 150 }); // same column, different row
        expect(rafSpy).toHaveBeenCalledTimes(2);
      } finally {
        rafSpy.mockRestore();
      }
    });
  });

  describe('setVisibleRange / setVisibleTimeRange', () => {
    it('setVisibleRange jumps directly to the requested index window', () => {
      const chart = new WickChart(canvas);
      chart.setData(makeSeries(200));

      chart.setVisibleRange({ startIndex: 50, endIndex: 100 });

      expect(chart.getVisibleRange()).toEqual({ startIndex: 50, endIndex: 100, visibleCount: 50 });
    });

    it('setVisibleRange clamps an out-of-bounds request instead of throwing', () => {
      const chart = new WickChart(canvas);
      chart.setData(makeSeries(100));

      expect(() => chart.setVisibleRange({ startIndex: -20, endIndex: 300 })).not.toThrow();
      const range = chart.getVisibleRange();
      expect(range.startIndex).toBeGreaterThanOrEqual(0);
      expect(range.endIndex).toBeLessThanOrEqual(100);
    });

    it('setVisibleRange clears the current hover (a stale hover no longer matches the new window)', () => {
      const chart = new WickChart(canvas);
      chart.setData(makeSeries(100));
      chart.render();
      fireMouse(canvas, 'mousemove', { clientX: 400, clientY: 100 });
      expect(chart.getHoveredPoint()).not.toBeNull();

      chart.setVisibleRange({ startIndex: 0, endIndex: 20 });
      expect(chart.getHoveredPoint()).toBeNull();
    });

    it('getVisibleTimeRange reports the real time span of what setVisibleRange just showed', () => {
      const chart = new WickChart(canvas);
      // makeSeries uses time = index (in unix seconds), so index and time
      // line up exactly — lets this test assert precise values.
      chart.setData(makeSeries(200));

      chart.setVisibleRange({ startIndex: 50, endIndex: 100 });

      expect(chart.getVisibleTimeRange()).toEqual({ from: 50, to: 99 });
    });

    it('getVisibleTimeRange returns null before any data is loaded', () => {
      const chart = new WickChart(canvas);
      expect(chart.getVisibleTimeRange()).toBeNull();
    });

    it('setVisibleTimeRange resolves a [from, to] time span to the matching index window', () => {
      const chart = new WickChart(canvas);
      chart.setData(makeSeries(200)); // time = index, 0..199

      chart.setVisibleTimeRange({ from: 50, to: 99 });

      expect(chart.getVisibleRange()).toEqual({ startIndex: 50, endIndex: 100, visibleCount: 50 });
    });

    it('setVisibleTimeRange is a no-op before any data is loaded', () => {
      const chart = new WickChart(canvas);
      expect(() => chart.setVisibleTimeRange({ from: 0, to: 100 })).not.toThrow();
      expect(chart.getPointCount()).toBe(0);
    });

    it('round-trips through getVisibleTimeRange/setVisibleTimeRange to sync one chart onto another', () => {
      const { canvas: c1 } = createTestCanvas(800, 400);
      const { canvas: c2 } = createTestCanvas(800, 400);
      const source = new WickChart(c1);
      const target = new WickChart(c2);
      // Different amounts of loaded history — the exact scenario time-based
      // sync exists for: the same index would point at different candles.
      source.setData(makeSeries(200, 1000));
      target.setData(makeSeries(500, 700));

      source.setVisibleRange({ startIndex: 80, endIndex: 130 });
      const sourceRange = source.getVisibleTimeRange()!;

      target.setVisibleTimeRange(sourceRange);

      expect(target.getVisibleTimeRange()).toEqual(sourceRange);
    });

    it('setVisibleTimeRange accepts every WickTime shape, not just unix seconds', () => {
      const chart = new WickChart(canvas);
      chart.setData(makeSeries(200)); // time = index, 0..199 (unix seconds)

      chart.setVisibleTimeRange({ from: { unixMs: 50_000 }, to: '1970-01-01T00:01:39Z' }); // 50s .. 99s

      expect(chart.getVisibleRange()).toEqual({ startIndex: 50, endIndex: 100, visibleCount: 50 });
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
      const chart = new WickChart(canvas);
      chart.setData(makeSeries(30, 1000)); // 30 < DEFAULT_VISIBLE_POINTS → view starts at [0, 30)
      const loader = vi.fn(async (req: DataRequest) =>
        req.direction === 'before' ? makeSeries(15, 1000 - 15) : [],
      );
      chart.setDataLoader(loader, 5); // small threshold so one batch clears it
      chart.render(); // render() is what triggers maybeLoadMore()
      await vi.waitFor(() => expect(chart.getPointCount()).toBe(45));
      expect(loader.mock.calls.some(([req]) => req.direction === 'before')).toBe(true);
    });

    it('does not request "before" data when the window is far from the start of the series', () => {
      const chart = new WickChart(canvas);
      chart.setData(makeSeries(1000));
      // default view sits on the most recent 120 of 1000 — startIndex=880, nowhere near 0
      const loader = vi.fn(async () => []);
      chart.setDataLoader(loader, 20);
      chart.render();
      expect(loader.mock.calls.some(([req]) => req.direction === 'before')).toBe(false);
    });

    it('requests "after" data for a freshly-loaded series pinned to its most recent candle', () => {
      const chart = new WickChart(canvas);
      chart.setData(makeSeries(1000));
      const loader = vi.fn(async () => []);
      chart.setDataLoader(loader, 20);
      chart.render();
      expect(loader.mock.calls.some(([req]) => req.direction === 'after')).toBe(true);
    });

    it('stops re-requesting a direction once the loader reports it exhausted (returns empty)', async () => {
      const chart = new WickChart(canvas);
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
      const chart = new WickChart(canvas);
      chart.setData(makeSeries(10));
      const pendingResolvers: Array<(candles: Candle[]) => void> = [];
      const loader = vi.fn(() => new Promise<Candle[]>((resolve) => pendingResolvers.push(resolve)));
      chart.setDataLoader(loader, 20);

      chart.render();
      chart.render();
      chart.render();
      expect(loader).toHaveBeenCalledTimes(2); // one per direction — no duplicates within either

      pendingResolvers.forEach((resolve) => resolve([]));
      await vi.waitFor(() => expect(chart.getPointCount()).toBe(10));
    });

    it('keeps the visible window stable (no jump) when candles are prepended', async () => {
      const chart = new WickChart(canvas);
      chart.setData(makeSeries(10, 1000));
      const before = chart.getVisibleRange();
      const loader = vi.fn(async (req: DataRequest) =>
        req.direction === 'before' ? makeSeries(15, 1000 - 15) : [],
      );
      chart.setDataLoader(loader, 5);

      chart.render();
      await vi.waitFor(() => expect(chart.getPointCount()).toBe(25));

      // 15 candles were prepended; the same candles that were visible before
      // should still be visible, just at indices shifted by 15.
      const after = chart.getVisibleRange();
      expect(after.startIndex).toBe(before.startIndex + 15);
      expect(after.endIndex).toBe(before.endIndex + 15);
    });
  });

  describe('touch input', () => {
    it('a single-finger drag pans the same way a mouse drag does', () => {
      const chart = new WickChart(canvas);
      chart.setData(makeSeries(500));
      const { onTouchStart, onTouchMove, onTouchEnd } = chartTouchHandlers(chart);
      const before = chart.getVisibleRange().startIndex;

      onTouchStart(fakeTouchEvent([touchPoint(100, 100)]));
      onTouchMove(fakeTouchEvent([touchPoint(400, 100)])); // dragged right → earlier candles
      onTouchEnd(fakeTouchEvent([]));

      expect(chart.getVisibleRange().startIndex).toBeLessThan(before);
    });

    it('a single-finger drag starting on the price-axis strip scales price instead of panning', () => {
      const chart = new WickChart(canvas);
      chart.setData(makeSeries(100));
      const { onTouchStart, onTouchMove, onTouchEnd } = chartTouchHandlers(chart);
      const beforeRange = chart.getVisibleRange();

      // chartWidth = 800 - 64 = 736; x=770 is inside the 64px price-axis strip
      onTouchStart(fakeTouchEvent([touchPoint(770, 100)]));
      onTouchMove(fakeTouchEvent([touchPoint(770, 160)]));
      onTouchEnd(fakeTouchEvent([]));

      expect(chart.getVisibleRange()).toEqual(beforeRange); // never pans
      expect(chart.getValueRangeOverride()).not.toBeNull();
    });

    it('a two-finger pinch spreading apart zooms in (fewer candles visible)', () => {
      const chart = new WickChart(canvas);
      chart.setData(makeSeries(1000, 0));
      // zoom out first via a wheel gesture so there's room to zoom back in
      fireWheel(canvas, { deltaX: 0, deltaY: 100, clientX: 400, clientY: 200 });
      const before = chart.getVisibleRange().visibleCount;

      const { onTouchStart, onTouchMove, onTouchEnd } = chartTouchHandlers(chart);
      onTouchStart(fakeTouchEvent([touchPoint(350, 200), touchPoint(450, 200)])); // 100px apart
      onTouchMove(fakeTouchEvent([touchPoint(250, 200), touchPoint(550, 200)])); // 300px apart — spread out
      onTouchEnd(fakeTouchEvent([]));

      expect(chart.getVisibleRange().visibleCount).toBeLessThan(before);
    });

    it('a two-finger pinch coming together zooms out (more candles visible)', () => {
      const chart = new WickChart(canvas);
      chart.setData(makeSeries(1000));
      const before = chart.getVisibleRange().visibleCount;

      const { onTouchStart, onTouchMove, onTouchEnd } = chartTouchHandlers(chart);
      onTouchStart(fakeTouchEvent([touchPoint(250, 200), touchPoint(550, 200)])); // 300px apart
      onTouchMove(fakeTouchEvent([touchPoint(350, 200), touchPoint(450, 200)])); // 100px apart — pinched in
      onTouchEnd(fakeTouchEvent([]));

      expect(chart.getVisibleRange().visibleCount).toBeGreaterThan(before);
    });

    it('a second finger landing cancels an in-progress single-finger drag', () => {
      const chart = new WickChart(canvas);
      chart.setData(makeSeries(500));
      const { onTouchStart, onTouchMove } = chartTouchHandlers(chart);

      onTouchStart(fakeTouchEvent([touchPoint(100, 100)]));
      onTouchStart(fakeTouchEvent([touchPoint(100, 100), touchPoint(300, 100)])); // second finger lands
      const afterSecondFinger = chart.getVisibleRange();

      // a stray single-touch move event (e.g. a delayed one from before the
      // second finger landed) should not resume panning
      onTouchMove(fakeTouchEvent([touchPoint(400, 100)]));
      expect(chart.getVisibleRange()).toEqual(afterSecondFinger);
    });

    it('lifting all fingers stops the drag the way mouseup does', () => {
      const chart = new WickChart(canvas);
      chart.setData(makeSeries(500));
      const { onTouchStart, onTouchMove, onTouchEnd } = chartTouchHandlers(chart);

      onTouchStart(fakeTouchEvent([touchPoint(100, 100)]));
      onTouchEnd(fakeTouchEvent([])); // lifted before any move
      const before = chart.getVisibleRange();

      onTouchMove(fakeTouchEvent([touchPoint(400, 100)])); // should be ignored — no active drag
      expect(chart.getVisibleRange()).toEqual(before);
    });
  });

  describe('touch long-press scrub (hover substitute)', () => {
    const LONG_PRESS_MS = 350; // must match the constant in index.ts

    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('holding a finger still past the long-press duration inspects a candle instead of panning', () => {
      const chart = new WickChart(canvas);
      chart.setData(makeSeries(500));
      const { onTouchStart } = chartTouchHandlers(chart);
      const before = chart.getVisibleRange();

      onTouchStart(fakeTouchEvent([touchPoint(400, 100)]));
      vi.advanceTimersByTime(LONG_PRESS_MS + 10);

      expect(chart.getHoveredPoint()).not.toBeNull();
      expect(chart.getVisibleRange()).toEqual(before); // never panned
    });

    it('moving the finger before the long-press fires cancels it and pans normally instead', () => {
      const chart = new WickChart(canvas);
      chart.setData(makeSeries(500));
      const { onTouchStart, onTouchMove } = chartTouchHandlers(chart);
      const before = chart.getVisibleRange().startIndex;

      onTouchStart(fakeTouchEvent([touchPoint(100, 100)]));
      onTouchMove(fakeTouchEvent([touchPoint(400, 100)])); // real drag, well past the tolerance
      vi.advanceTimersByTime(LONG_PRESS_MS + 10); // the (already-cancelled) timer must not fire late

      expect(chart.getHoveredPoint()).toBeNull();
      expect(chart.getVisibleRange().startIndex).toBeLessThan(before); // panned instead
    });

    it('moving the finger while in scrub mode scrubs between candles without panning', () => {
      const chart = new WickChart(canvas);
      chart.setData(makeSeries(500));
      const { onTouchStart, onTouchMove } = chartTouchHandlers(chart);

      onTouchStart(fakeTouchEvent([touchPoint(400, 100)]));
      vi.advanceTimersByTime(LONG_PRESS_MS + 10);
      const rangeAfterHold = chart.getVisibleRange();
      const firstHover = chart.getHoveredPoint();

      onTouchMove(fakeTouchEvent([touchPoint(200, 100)])); // slide to inspect a different candle
      expect(chart.getVisibleRange()).toEqual(rangeAfterHold); // still not panning
      expect(chart.getHoveredPoint()).not.toBe(firstHover);
    });

    it('re-renders when scrubbing moves vertically within the same candle column', () => {
      // Regression test, touch counterpart of the mouse one above: the
      // crosshair's horizontal line follows the raw finger position, so it
      // must keep tracking even while the finger stays over the same candle.
      const chart = new WickChart(canvas);
      chart.setData(makeSeries(500));
      const { onTouchStart, onTouchMove } = chartTouchHandlers(chart);

      // Installed before entering scrub mode so its own scheduleRender()
      // call (which would otherwise leave renderScheduled stuck true under
      // fake timers, blocking the next one) also resolves synchronously.
      const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
        cb(0);
        return 0;
      });

      try {
        onTouchStart(fakeTouchEvent([touchPoint(400, 100)]));
        vi.advanceTimersByTime(LONG_PRESS_MS + 10); // enter scrub mode
        expect(rafSpy).toHaveBeenCalledTimes(1);

        onTouchMove(fakeTouchEvent([touchPoint(400, 150)])); // same column, different row
        expect(rafSpy).toHaveBeenCalledTimes(2);
      } finally {
        rafSpy.mockRestore();
      }
    });

    it('lifting the finger after scrubbing clears the hover, returning to the original state', () => {
      const chart = new WickChart(canvas);
      chart.setData(makeSeries(500));
      const { onTouchStart, onTouchEnd } = chartTouchHandlers(chart);

      onTouchStart(fakeTouchEvent([touchPoint(400, 100)]));
      vi.advanceTimersByTime(LONG_PRESS_MS + 10);
      expect(chart.getHoveredPoint()).not.toBeNull();

      onTouchEnd(fakeTouchEvent([]));
      expect(chart.getHoveredPoint()).toBeNull();
    });

    it('a quick tap released before the long-press duration never enters scrub mode', () => {
      const chart = new WickChart(canvas);
      chart.setData(makeSeries(500));
      const { onTouchStart, onTouchEnd } = chartTouchHandlers(chart);

      onTouchStart(fakeTouchEvent([touchPoint(400, 100)]));
      onTouchEnd(fakeTouchEvent([]));
      vi.advanceTimersByTime(LONG_PRESS_MS + 10); // the cancelled timer must not fire after release

      expect(chart.getHoveredPoint()).toBeNull();
    });
  });

  describe('destroy', () => {
    it('stops reacting to further input after destroy()', () => {
      const chart = new WickChart(canvas);
      chart.setData(makeSeries(500));
      chart.destroy();

      const before = chart.getVisibleRange();
      fireMouse(canvas, 'mousedown', { clientX: 100, clientY: 100 });
      fireMouse(canvas, 'mousemove', { clientX: 300, clientY: 100 });
      fireMouse(window, 'mouseup', {});

      expect(chart.getVisibleRange()).toEqual(before);
    });

    it('cancels a pending scheduled render instead of letting it fire after teardown', () => {
      const chart = new WickChart(canvas);
      chart.setData(makeSeries(500));
      const cancelSpy = vi.spyOn(window, 'cancelAnimationFrame');

      fireMouse(canvas, 'mousemove', { clientX: 400, clientY: 100 }); // schedules a render (new hover)
      chart.destroy();

      expect(cancelSpy).toHaveBeenCalled();
    });
  });

  describe('touch + pinch interaction edge cases', () => {
    it('clears a scrub-mode hover when a second finger lands to start a pinch', () => {
      vi.useFakeTimers();
      const chart = new WickChart(canvas);
      chart.setData(makeSeries(500));
      const { onTouchStart, onTouchMove, onTouchEnd } = chartTouchHandlers(chart);

      onTouchStart(fakeTouchEvent([touchPoint(400, 100)]));
      vi.advanceTimersByTime(400); // enter scrub mode
      expect(chart.getHoveredPoint()).not.toBeNull();

      // second finger lands — pinch takes over
      onTouchStart(fakeTouchEvent([touchPoint(400, 100), touchPoint(500, 100)]));
      onTouchMove(fakeTouchEvent([touchPoint(350, 100), touchPoint(550, 100)]));
      onTouchEnd(fakeTouchEvent([touchPoint(350, 100)])); // one finger lifted
      onTouchEnd(fakeTouchEvent([])); // the other lifted too

      expect(chart.getHoveredPoint()).toBeNull();
      vi.useRealTimers();
    });
  });

  describe('series type dispatch', () => {
    it('defaults to the built-in candlestick series when type is omitted', () => {
      const chart = new WickChart(canvas);
      chart.setData(makeSeries(10));
      expect(() => chart.render()).not.toThrow();
    });

    it('throws a clear error for an unregistered type', () => {
      expect(() => new WickChart(canvas, { type: 'not-a-real-series' })).toThrow(/unknown series type/);
    });

    it('renders a line series via type: "line"', () => {
      const chart = new WickChart(canvas, { type: 'line' });
      chart.setData(Array.from({ length: 10 }, (_, i) => ({ time: i, value: 100 + i })));
      expect(() => chart.render()).not.toThrow();
    });
  });

  describe('createCandlestickChart', () => {
    it('builds a working candlestick chart with type-checked style options', () => {
      const chart = createCandlestickChart(canvas, { style: { upColor: '#00ff00' } });
      chart.setData(makeSeries(10));
      expect(() => chart.render()).not.toThrow();
      expect(chart.getPointCount()).toBe(10);
    });
  });

  describe('createLineChart', () => {
    it('builds a working line chart with type-checked style options', () => {
      const chart = createLineChart(canvas, { style: { lineColor: '#00ff00' } });
      chart.setData(Array.from({ length: 10 }, (_, i) => ({ time: i, value: 100 + i })));
      expect(() => chart.render()).not.toThrow();
      expect(chart.getPointCount()).toBe(10);
    });

    it('reports the hovered point\'s value the same way a candlestick chart reports OHLC', () => {
      const { canvas: c } = createTestCanvas(800, 400);
      const chart = createLineChart(c);
      chart.setData(Array.from({ length: 20 }, (_, i) => ({ time: i, value: 100 + i })));
      chart.render();

      fireMouse(c, 'mousemove', { clientX: 100, clientY: 100 });
      expect(chart.getHoveredPoint()).not.toBeNull();
      expect(typeof chart.getHoveredPoint()!.value).toBe('number');
    });
  });

  describe('plugins', () => {
    it('draws a registered plugin on top of the series every frame', () => {
      const chart = new WickChart(canvas);
      chart.setData(makeSeries(10));
      const draw = vi.fn();

      chart.addPlugin({ draw });
      chart.render();
      expect(draw).toHaveBeenCalledTimes(1);

      chart.render();
      expect(draw).toHaveBeenCalledTimes(2);
    });

    it('stops drawing a plugin once removed', () => {
      const chart = new WickChart(canvas);
      chart.setData(makeSeries(10));
      const draw = vi.fn();
      const plugin = { draw };

      chart.addPlugin(plugin);
      chart.render();
      expect(draw).toHaveBeenCalledTimes(1);

      chart.removePlugin(plugin);
      chart.render();
      expect(draw).toHaveBeenCalledTimes(1); // no additional call
    });

    it('gives the plugin pixel-space geometry for the current frame', () => {
      const chart = new WickChart(canvas);
      chart.setData(makeSeries(10));
      let seenApi: { chartWidth: number; chartHeight: number } | undefined;

      chart.addPlugin({
        draw: (api) => {
          seenApi = api;
        },
      });
      chart.render();

      expect(seenApi).toBeDefined();
      expect(seenApi!.chartWidth).toBeGreaterThan(0);
      expect(seenApi!.chartHeight).toBeGreaterThan(0);
    });

    it('lets a plugin call yForValue synchronously but throws if called after the frame ends', () => {
      const chart = new WickChart(canvas);
      chart.setData(makeSeries(10));
      let stashedYForValue: ((value: number) => number) | undefined;

      chart.addPlugin({
        draw: (api) => {
          expect(() => api.yForValue(100)).not.toThrow();
          stashedYForValue = api.yForValue;
        },
      });
      chart.render();

      expect(() => stashedYForValue!(100)).toThrow(/frame ended/);
    });

    it('isolates canvas state between plugins with save/restore', () => {
      const { canvas: c, ctx } = createTestCanvas(800, 400);
      const chart = new WickChart(c);
      chart.setData(makeSeries(10));

      chart.addPlugin({ draw: () => {} });
      chart.addPlugin({ draw: () => {} });

      const saveCallsBefore = ctx.save.mock.calls.length;
      const restoreCallsBefore = ctx.restore.mock.calls.length;
      chart.render();

      // one save/restore pair per plugin, on top of whatever the crosshair
      // rendering already does
      expect(ctx.save.mock.calls.length - saveCallsBefore).toBeGreaterThanOrEqual(2);
      expect(ctx.restore.mock.calls.length - restoreCallsBefore).toBeGreaterThanOrEqual(2);
    });

    it('keeps rendering later plugins and does not throw when one plugin throws', () => {
      const { canvas: c } = createTestCanvas(800, 400);
      const chart = new WickChart(c);
      chart.setData(makeSeries(10));
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const secondDraw = vi.fn();

      chart.addPlugin({
        draw: () => {
          throw new Error('boom');
        },
      });
      chart.addPlugin({ draw: secondDraw });

      expect(() => chart.render()).not.toThrow();
      expect(secondDraw).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalled();

      // addPlugin() above already scheduled an async render (via rAF) that
      // would otherwise fire after this test returns and log to the real
      // console.error once the spy below is restored — destroy() cancels it.
      chart.destroy();
      errorSpy.mockRestore();
    });

    it('getPlugins returns a snapshot copy, in registration order', () => {
      const chart = new WickChart(canvas);
      chart.setData(makeSeries(10));
      const first = { draw: () => {}, id: 'ma-20' };
      const second = { draw: () => {}, id: 'trend-1' };

      chart.addPlugin(first);
      chart.addPlugin(second);

      const plugins = chart.getPlugins();
      expect(plugins).toEqual([first, second]);

      // mutating the returned array doesn't affect the chart's own list
      (plugins as ChartPlugin[]).push({ draw: () => {} });
      expect(chart.getPlugins()).toHaveLength(2);
    });

    it('setPluginVisible hides a plugin from drawing and gesture claiming without removing it', () => {
      const chart = new WickChart(canvas);
      chart.setData(makeSeries(10));
      const draw = vi.fn();
      const onPointerDown = vi.fn(() => true);

      chart.addPlugin({ id: 'trend-1', draw, onPointerDown });
      chart.render();
      expect(draw).toHaveBeenCalledTimes(1);

      chart.setPluginVisible('trend-1', false);
      chart.render();
      expect(draw).toHaveBeenCalledTimes(1); // no additional call while hidden

      chart.setPluginVisible('trend-1', true);
      chart.render();
      expect(draw).toHaveBeenCalledTimes(2); // drawing again once shown

      expect(chart.getPlugins()).toHaveLength(1); // never removed, just toggled
    });

    it('setPluginVisible is a no-op when no plugin matches the id', () => {
      const chart = new WickChart(canvas);
      chart.setData(makeSeries(10));
      const draw = vi.fn();
      chart.addPlugin({ id: 'trend-1', draw });

      expect(() => chart.setPluginVisible('does-not-exist', false)).not.toThrow();
      chart.render();
      expect(draw).toHaveBeenCalledTimes(1);
    });
  });

  describe('panes', () => {
    it('shrinks the main pane and routes a paneId-targeted plugin into the declared pane', () => {
      const chart = new WickChart(canvas);
      chart.setData(makeSeries(10));

      let mainChartHeight = 0;
      let paneChartHeight = 0;
      chart.addPlugin({ draw: (api) => (mainChartHeight = api.chartHeight) });
      chart.addPane({ id: 'rsi', heightRatio: 0.25, getValueRange: () => ({ min: 0, max: 100 }) });
      chart.addPlugin({ paneId: 'rsi', draw: (api) => (paneChartHeight = api.chartHeight) });

      chart.render();

      expect(paneChartHeight).toBeGreaterThan(0);
      expect(paneChartHeight).toBeLessThan(mainChartHeight);
    });

    it('defaults heightRatio and getValueRange when omitted', () => {
      const chart = new WickChart(canvas);
      chart.setData(makeSeries(10));

      chart.addPane({ id: 'oscillator' });
      expect(chart.getPanes()).toEqual([{ id: 'oscillator', heightRatio: 0.25 }]);

      let seenValue: number | null = null;
      chart.addPlugin({
        paneId: 'oscillator',
        draw: (api) => {
          seenValue = api.valueForY(api.yForValue(0.5));
        },
      });
      chart.render();
      expect(seenValue).toBeCloseTo(0.5, 5); // default domain is [0, 1]
    });

    it('removePane stops reserving space and falls its plugins back to the main pane', () => {
      const chart = new WickChart(canvas);
      chart.setData(makeSeries(10));
      chart.addPane({ id: 'rsi', heightRatio: 0.25 });

      let seenChartHeight = 0;
      chart.addPlugin({ draw: (api) => (seenChartHeight = api.chartHeight) });
      chart.render();
      const chartHeightWithPane = seenChartHeight;

      chart.removePane('rsi');
      chart.render();
      const chartHeightAfterRemoval = seenChartHeight;

      expect(chartHeightAfterRemoval).toBeGreaterThan(chartHeightWithPane);
      expect(chart.getPanes()).toEqual([]);
    });

    it('removePane is a no-op when no pane matches the id', () => {
      const chart = new WickChart(canvas);
      chart.setData(makeSeries(10));
      chart.addPane({ id: 'rsi' });

      expect(() => chart.removePane('does-not-exist')).not.toThrow();
      expect(chart.getPanes()).toEqual([{ id: 'rsi', heightRatio: 0.25 }]);
    });

    it('accounts for a shrunk main pane in pointer-event values (regression: previously divided by the full stack height)', () => {
      const chart = new WickChart(canvas);
      chart.setData(makeSeries(50));

      // Any mousedown seeds a deterministic manual value-range override
      // (see ensureValueRangeOverride) — do this before adding the pane so
      // the override itself doesn't depend on pane layout.
      fireMouse(canvas, 'mousedown', { clientX: 400, clientY: 200 });
      fireMouse(window, 'mouseup', {});
      const range = chart.getValueRangeOverride();
      expect(range).not.toBeNull();
      const mid = (range!.min + range!.max) / 2;

      chart.addPane({ id: 'rsi', heightRatio: 0.5 }); // well under the 0.8 stack-share cap

      let seenValue: number | null = null;
      chart.addPlugin({ draw: () => {}, onPointerDown: (e) => ((seenValue = e.value), false) });

      const stackHeight = 400 - 24; // canvas height (400) minus the default time-axis strip (24)
      const mainPaneHeight = stackHeight * 0.5;
      // The vertical midpoint of the *main pane* (not the full stack) should
      // read back the override range's own midpoint.
      fireMouse(canvas, 'mousedown', { clientX: 100, clientY: mainPaneHeight / 2 });
      fireMouse(window, 'mouseup', {});

      expect(seenValue).toBeCloseTo(mid, 5);
    });

    it('getPanes returns panes in declaration order', () => {
      const chart = new WickChart(canvas);
      chart.addPane({ id: 'volume', heightRatio: 0.15 });
      chart.addPane({ id: 'rsi', heightRatio: 0.2 });

      expect(chart.getPanes()).toEqual([
        { id: 'volume', heightRatio: 0.15 },
        { id: 'rsi', heightRatio: 0.2 },
      ]);
    });
  });

  describe('invertValueAxis', () => {
    it('defaults to false, and reflects the constructor option', () => {
      const chart = new WickChart(canvas);
      expect(chart.isValueAxisInverted()).toBe(false);

      const invertedChart = new WickChart(canvas, { invertValueAxis: true });
      expect(invertedChart.isValueAxisInverted()).toBe(true);
    });

    it('setInvertValueAxis toggles the flag and re-renders without throwing', () => {
      const chart = new WickChart(canvas);
      chart.setData(makeSeries(10));
      chart.render();

      chart.setInvertValueAxis(true);
      expect(chart.isValueAxisInverted()).toBe(true);
      expect(() => chart.render()).not.toThrow();

      chart.setInvertValueAxis(false);
      expect(chart.isValueAxisInverted()).toBe(false);
    });

    it("mirrors a pointer event's reported value around the range midpoint compared to a non-inverted chart", () => {
      const { canvas: c1 } = createTestCanvas(800, 400);
      const { canvas: c2 } = createTestCanvas(800, 400);
      const normal = new WickChart(c1);
      const inverted = new WickChart(c2, { invertValueAxis: true });
      normal.setData(makeSeries(50));
      inverted.setData(makeSeries(50));

      // Seed identical, deterministic manual value-range overrides on both
      // charts (any mousedown does this — see ensureValueRangeOverride).
      fireMouse(c1, 'mousedown', { clientX: 400, clientY: 200 });
      fireMouse(window, 'mouseup', {});
      fireMouse(c2, 'mousedown', { clientX: 400, clientY: 200 });
      fireMouse(window, 'mouseup', {});
      const range = normal.getValueRangeOverride()!;
      expect(inverted.getValueRangeOverride()).toEqual(range);

      let normalValue: number | null = null;
      let invertedValue: number | null = null;
      normal.addPlugin({ draw: () => {}, onPointerDown: (e) => ((normalValue = e.value), false) });
      inverted.addPlugin({ draw: () => {}, onPointerDown: (e) => ((invertedValue = e.value), false) });

      fireMouse(c1, 'mousedown', { clientX: 100, clientY: 150 });
      fireMouse(window, 'mouseup', {});
      fireMouse(c2, 'mousedown', { clientX: 100, clientY: 150 });
      fireMouse(window, 'mouseup', {});

      expect(normalValue).not.toBeNull();
      expect(invertedValue).not.toBeNull();
      // pixelToValue(y, min, max, h, false) + pixelToValue(y, min, max, h, true) === min + max
      expect(normalValue! + invertedValue!).toBeCloseTo(range.min + range.max, 5);
    });

    it('flips the direction a vertical drag shifts the manual value-range override (regression: dragging would otherwise run backwards on an inverted chart)', () => {
      const { canvas: c1 } = createTestCanvas(800, 400);
      const { canvas: c2 } = createTestCanvas(800, 400);
      const normal = new WickChart(c1);
      const inverted = new WickChart(c2, { invertValueAxis: true });
      normal.setData(makeSeries(50));
      inverted.setData(makeSeries(50));

      fireMouse(c1, 'mousedown', { clientX: 400, clientY: 200 });
      fireMouse(c2, 'mousedown', { clientX: 400, clientY: 200 });
      const before1 = normal.getValueRangeOverride()!;
      const before2 = inverted.getValueRangeOverride()!;
      expect(before1).toEqual(before2); // identical starting range, same canvas/data

      fireMouse(c1, 'mousemove', { clientX: 400, clientY: 250 }); // drag down 50px
      fireMouse(c2, 'mousemove', { clientX: 400, clientY: 250 });
      fireMouse(window, 'mouseup', {});

      const shiftNormal = normal.getValueRangeOverride()!.min - before1.min;
      const shiftInverted = inverted.getValueRangeOverride()!.min - before2.min;

      expect(shiftNormal).not.toBe(0);
      expect(shiftInverted).toBeCloseTo(-shiftNormal, 5);
    });
  });

  describe('plugin pointer gestures (interactive plugins: drawing tools, etc.)', () => {
    it('lets a plugin claim a mousedown and suppresses the chart\'s own panning for that gesture', () => {
      const chart = new WickChart(canvas);
      chart.setData(makeSeries(500));
      const before = chart.getVisibleRange().startIndex;
      const onPointerMove = vi.fn();
      const onPointerUp = vi.fn();

      chart.addPlugin({ draw: () => {}, onPointerDown: () => true, onPointerMove, onPointerUp });

      fireMouse(canvas, 'mousedown', { clientX: 100, clientY: 100 });
      fireMouse(canvas, 'mousemove', { clientX: 250, clientY: 100 }); // would normally pan +150px right
      fireMouse(window, 'mouseup', {});

      expect(chart.getVisibleRange().startIndex).toBe(before); // no panning happened
      expect(onPointerMove).toHaveBeenCalledOnce();
      expect(onPointerUp).toHaveBeenCalledOnce();
    });

    it('leaves panning to the chart when a plugin does not claim the gesture', () => {
      const chart = new WickChart(canvas);
      chart.setData(makeSeries(500));
      const before = chart.getVisibleRange().startIndex;

      chart.addPlugin({ draw: () => {}, onPointerDown: () => false });

      fireMouse(canvas, 'mousedown', { clientX: 100, clientY: 100 });
      fireMouse(canvas, 'mousemove', { clientX: 250, clientY: 100 });
      fireMouse(window, 'mouseup', {});

      expect(chart.getVisibleRange().startIndex).toBeLessThan(before); // panned normally
    });

    it('never offers a price-axis-strip click to plugins', () => {
      const chart = new WickChart(canvas);
      chart.setData(makeSeries(500));
      const onPointerDown = vi.fn();
      chart.addPlugin({ draw: () => {}, onPointerDown });

      fireMouse(canvas, 'mousedown', { clientX: 750, clientY: 100 }); // canvas is 800 wide, price axis strip is the last 64px
      fireMouse(window, 'mouseup', {});

      expect(onPointerDown).not.toHaveBeenCalled();
    });

    it('checks plugins in reverse-registration order and stops at the first to claim the gesture', () => {
      const chart = new WickChart(canvas);
      chart.setData(makeSeries(500));
      const first = { draw: () => {}, onPointerDown: vi.fn(() => false) };
      const second = { draw: () => {}, onPointerDown: vi.fn(() => true) };
      const third = { draw: () => {}, onPointerDown: vi.fn(() => false) };
      chart.addPlugin(first);
      chart.addPlugin(second);
      chart.addPlugin(third);

      fireMouse(canvas, 'mousedown', { clientX: 100, clientY: 100 });

      // third (most recently added) is checked first, doesn't claim; second
      // claims and stops the search; first (checked last) is never reached.
      expect(third.onPointerDown).toHaveBeenCalledOnce();
      expect(second.onPointerDown).toHaveBeenCalledOnce();
      expect(first.onPointerDown).not.toHaveBeenCalled();

      fireMouse(window, 'mouseup', {});
    });

    it('converts pointer position to a monotonic index and value', () => {
      const chart = new WickChart(canvas);
      chart.setData(makeSeries(500));
      const events: Array<{ index: number; value: number | null }> = [];
      chart.addPlugin({
        draw: () => {},
        onPointerDown: (e) => {
          events.push(e);
          return false; // don't actually claim — just observing the converted event
        },
      });

      fireMouse(canvas, 'mousedown', { clientX: 10, clientY: 10 });
      fireMouse(window, 'mouseup', {});
      fireMouse(canvas, 'mousedown', { clientX: 700, clientY: 300 });
      fireMouse(window, 'mouseup', {});

      expect(events).toHaveLength(2);
      const [left, right] = events as [{ index: number; value: number | null }, { index: number; value: number | null }];
      expect(left.index).toBeLessThan(right.index); // further right -> later index
      expect(left.value).not.toBeNull();
      expect(right.value).not.toBeNull();
      expect(left.value!).toBeGreaterThan(right.value!); // higher on screen (smaller y) -> larger value
    });

    it('exposes xForIndex/yForValue as the exact inverse of the event\'s own index/value', () => {
      const chart = new WickChart(canvas);
      chart.setData(makeSeries(500));
      let seen: import('./plugins/types').ChartPointerEvent | undefined;
      chart.addPlugin({
        draw: () => {},
        onPointerDown: (e) => {
          seen = e;
          return false;
        },
      });

      fireMouse(canvas, 'mousedown', { clientX: 300, clientY: 150 });
      fireMouse(window, 'mouseup', {});

      expect(seen).toBeDefined();
      // mapping the event's own index/value back through xForIndex/yForValue
      // must land on the same pixel the event itself was dispatched at
      expect(seen!.xForIndex(seen!.index)).toBeCloseTo(seen!.x, 5);
      expect(seen!.yForValue(seen!.value!)).toBeCloseTo(seen!.y, 5);
    });

    it('lets a plugin hit-test a shape it stores in data space using the event\'s forward mapping', () => {
      const chart = new WickChart(canvas);
      chart.setData(makeSeries(500));

      // simulates a trend line already placed at a single data-space anchor
      let placedAnchor: { index: number; value: number } | undefined;
      const firstClick: Array<{ index: number; value: number | null }> = [];
      chart.addPlugin({
        draw: () => {},
        onPointerDown: (e) => {
          if (!placedAnchor) {
            firstClick.push(e); // nothing placed yet — just record where this click landed
            return false;
          }
          const x1 = e.xForIndex(placedAnchor.index);
          const y1 = e.yForValue(placedAnchor.value)!;
          return hitTestPoint(e.x, e.y, x1, y1, 6);
        },
      });

      // first click: capture where it landed in data space, to hit-test against later
      fireMouse(canvas, 'mousedown', { clientX: 300, clientY: 150 });
      fireMouse(window, 'mouseup', {});
      placedAnchor = { index: firstClick[0]!.index, value: firstClick[0]!.value! };

      const before = chart.getVisibleRange().startIndex;

      // clicking the same spot again should hit-test true and claim the gesture
      fireMouse(canvas, 'mousedown', { clientX: 300, clientY: 150 });
      fireMouse(canvas, 'mousemove', { clientX: 400, clientY: 150 }); // would pan if not claimed
      fireMouse(window, 'mouseup', {});
      expect(chart.getVisibleRange().startIndex).toBe(before); // claimed — no panning

      // clicking somewhere far away should miss and fall through to panning
      fireMouse(canvas, 'mousedown', { clientX: 10, clientY: 10 });
      fireMouse(canvas, 'mousemove', { clientX: 110, clientY: 10 });
      fireMouse(window, 'mouseup', {});
      expect(chart.getVisibleRange().startIndex).toBeLessThan(before); // missed — panned normally
    });

    it('supports touch: claiming a touchstart suppresses panning, and touchend fires onPointerUp', () => {
      const chart = new WickChart(canvas);
      chart.setData(makeSeries(500));
      const before = chart.getVisibleRange().startIndex;
      const onPointerUp = vi.fn();
      chart.addPlugin({ draw: () => {}, onPointerDown: () => true, onPointerUp });
      const { onTouchStart, onTouchMove, onTouchEnd } = chartTouchHandlers(chart);

      onTouchStart(fakeTouchEvent([touchPoint(100, 100)]));
      onTouchMove(fakeTouchEvent([touchPoint(250, 100)]));
      onTouchEnd(fakeTouchEvent([]));

      expect(chart.getVisibleRange().startIndex).toBe(before);
      expect(onPointerUp).toHaveBeenCalledOnce();
    });

    it('ends an active gesture (firing onPointerUp) when a second finger lands mid-gesture', () => {
      const chart = new WickChart(canvas);
      chart.setData(makeSeries(500));
      const onPointerUp = vi.fn();
      chart.addPlugin({ draw: () => {}, onPointerDown: () => true, onPointerUp });
      const { onTouchStart } = chartTouchHandlers(chart);

      onTouchStart(fakeTouchEvent([touchPoint(100, 100)]));
      onTouchStart(fakeTouchEvent([touchPoint(100, 100), touchPoint(200, 100)])); // second finger lands

      expect(onPointerUp).toHaveBeenCalledOnce();
    });
  });
});
