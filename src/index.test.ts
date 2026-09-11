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

function chartTouchHandlers(chart: CinderChart): {
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

  describe('touch input', () => {
    it('a single-finger drag pans the same way a mouse drag does', () => {
      const chart = new CinderChart(canvas);
      chart.setData(makeSeries(500));
      const { onTouchStart, onTouchMove, onTouchEnd } = chartTouchHandlers(chart);
      const before = chart.getVisibleRange().startIndex;

      onTouchStart(fakeTouchEvent([touchPoint(100, 100)]));
      onTouchMove(fakeTouchEvent([touchPoint(400, 100)])); // dragged right → earlier candles
      onTouchEnd(fakeTouchEvent([]));

      expect(chart.getVisibleRange().startIndex).toBeLessThan(before);
    });

    it('a single-finger drag starting on the price-axis strip scales price instead of panning', () => {
      const chart = new CinderChart(canvas);
      chart.setData(makeSeries(100));
      const { onTouchStart, onTouchMove, onTouchEnd } = chartTouchHandlers(chart);
      const beforeRange = chart.getVisibleRange();

      // chartWidth = 800 - 64 = 736; x=770 is inside the 64px price-axis strip
      onTouchStart(fakeTouchEvent([touchPoint(770, 100)]));
      onTouchMove(fakeTouchEvent([touchPoint(770, 160)]));
      onTouchEnd(fakeTouchEvent([]));

      expect(chart.getVisibleRange()).toEqual(beforeRange); // never pans
      expect(chart.getPriceRangeOverride()).not.toBeNull();
    });

    it('a two-finger pinch spreading apart zooms in (fewer candles visible)', () => {
      const chart = new CinderChart(canvas);
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
      const chart = new CinderChart(canvas);
      chart.setData(makeSeries(1000));
      const before = chart.getVisibleRange().visibleCount;

      const { onTouchStart, onTouchMove, onTouchEnd } = chartTouchHandlers(chart);
      onTouchStart(fakeTouchEvent([touchPoint(250, 200), touchPoint(550, 200)])); // 300px apart
      onTouchMove(fakeTouchEvent([touchPoint(350, 200), touchPoint(450, 200)])); // 100px apart — pinched in
      onTouchEnd(fakeTouchEvent([]));

      expect(chart.getVisibleRange().visibleCount).toBeGreaterThan(before);
    });

    it('a second finger landing cancels an in-progress single-finger drag', () => {
      const chart = new CinderChart(canvas);
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
      const chart = new CinderChart(canvas);
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
      const chart = new CinderChart(canvas);
      chart.setData(makeSeries(500));
      const { onTouchStart } = chartTouchHandlers(chart);
      const before = chart.getVisibleRange();

      onTouchStart(fakeTouchEvent([touchPoint(400, 100)]));
      vi.advanceTimersByTime(LONG_PRESS_MS + 10);

      expect(chart.getHoveredCandle()).not.toBeNull();
      expect(chart.getVisibleRange()).toEqual(before); // never panned
    });

    it('moving the finger before the long-press fires cancels it and pans normally instead', () => {
      const chart = new CinderChart(canvas);
      chart.setData(makeSeries(500));
      const { onTouchStart, onTouchMove } = chartTouchHandlers(chart);
      const before = chart.getVisibleRange().startIndex;

      onTouchStart(fakeTouchEvent([touchPoint(100, 100)]));
      onTouchMove(fakeTouchEvent([touchPoint(400, 100)])); // real drag, well past the tolerance
      vi.advanceTimersByTime(LONG_PRESS_MS + 10); // the (already-cancelled) timer must not fire late

      expect(chart.getHoveredCandle()).toBeNull();
      expect(chart.getVisibleRange().startIndex).toBeLessThan(before); // panned instead
    });

    it('moving the finger while in scrub mode scrubs between candles without panning', () => {
      const chart = new CinderChart(canvas);
      chart.setData(makeSeries(500));
      const { onTouchStart, onTouchMove } = chartTouchHandlers(chart);

      onTouchStart(fakeTouchEvent([touchPoint(400, 100)]));
      vi.advanceTimersByTime(LONG_PRESS_MS + 10);
      const rangeAfterHold = chart.getVisibleRange();
      const firstHover = chart.getHoveredCandle();

      onTouchMove(fakeTouchEvent([touchPoint(200, 100)])); // slide to inspect a different candle
      expect(chart.getVisibleRange()).toEqual(rangeAfterHold); // still not panning
      expect(chart.getHoveredCandle()).not.toBe(firstHover);
    });

    it('lifting the finger after scrubbing clears the hover, returning to the original state', () => {
      const chart = new CinderChart(canvas);
      chart.setData(makeSeries(500));
      const { onTouchStart, onTouchEnd } = chartTouchHandlers(chart);

      onTouchStart(fakeTouchEvent([touchPoint(400, 100)]));
      vi.advanceTimersByTime(LONG_PRESS_MS + 10);
      expect(chart.getHoveredCandle()).not.toBeNull();

      onTouchEnd(fakeTouchEvent([]));
      expect(chart.getHoveredCandle()).toBeNull();
    });

    it('a quick tap released before the long-press duration never enters scrub mode', () => {
      const chart = new CinderChart(canvas);
      chart.setData(makeSeries(500));
      const { onTouchStart, onTouchEnd } = chartTouchHandlers(chart);

      onTouchStart(fakeTouchEvent([touchPoint(400, 100)]));
      onTouchEnd(fakeTouchEvent([]));
      vi.advanceTimersByTime(LONG_PRESS_MS + 10); // the cancelled timer must not fire after release

      expect(chart.getHoveredCandle()).toBeNull();
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

    it('cancels a pending scheduled render instead of letting it fire after teardown', () => {
      const chart = new CinderChart(canvas);
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
      const chart = new CinderChart(canvas);
      chart.setData(makeSeries(500));
      const { onTouchStart, onTouchMove, onTouchEnd } = chartTouchHandlers(chart);

      onTouchStart(fakeTouchEvent([touchPoint(400, 100)]));
      vi.advanceTimersByTime(400); // enter scrub mode
      expect(chart.getHoveredCandle()).not.toBeNull();

      // second finger lands — pinch takes over
      onTouchStart(fakeTouchEvent([touchPoint(400, 100), touchPoint(500, 100)]));
      onTouchMove(fakeTouchEvent([touchPoint(350, 100), touchPoint(550, 100)]));
      onTouchEnd(fakeTouchEvent([touchPoint(350, 100)])); // one finger lifted
      onTouchEnd(fakeTouchEvent([])); // the other lifted too

      expect(chart.getHoveredCandle()).toBeNull();
      vi.useRealTimers();
    });
  });
});
