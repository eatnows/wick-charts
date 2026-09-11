import { describe, expect, it } from 'vitest';
import { Viewport } from './viewport';

describe('Viewport', () => {
  it('defaults to showing the most recent candles when narrower than the full series', () => {
    const vp = new Viewport(100, 20);
    expect(vp.visibleCount).toBe(20);
    expect(vp.startIndex).toBe(80);
    expect(vp.endIndex).toBe(100);
  });

  it('clamps pan so the window never leaves [0, totalCount]', () => {
    const vp = new Viewport(100, 20);
    vp.pan(1000, 100);
    expect(vp.startIndex).toBe(80); // already at max start

    vp.pan(-1000, 100);
    expect(vp.startIndex).toBe(0);
  });

  it('zoom keeps the anchor candle at the same relative position', () => {
    const vp = new Viewport(1000, 20);
    vp.startIndex = 400; // move away from the data edge so boundary clamping can't interfere
    const anchorIndex = 410; // dead center of [400, 420)
    vp.zoom(2, anchorIndex, 1000); // zoom out to 40 visible
    expect(vp.visibleCount).toBe(40);
    // anchor was at ratio 0.5 before, should stay ~0.5 after
    const ratio = (anchorIndex - vp.startIndex) / vp.visibleCount;
    expect(ratio).toBeCloseTo(0.5, 5);
  });

  it('clamps the anchor ratio near the data edge instead of overscrolling', () => {
    const vp = new Viewport(100, 20); // pinned to the right edge: start=80
    vp.zoom(2, 90, 100); // zooming out from the edge can't center the anchor without overscroll
    expect(vp.visibleCount).toBe(40);
    expect(vp.startIndex + vp.visibleCount).toBeLessThanOrEqual(100); // never shows past the last candle
    expect(vp.startIndex).toBeGreaterThanOrEqual(0); // never shows before the first candle
  });

  it('zoom never shrinks below the minimum visible count', () => {
    const vp = new Viewport(100, 10);
    vp.zoom(0.01, 95, 100);
    expect(vp.visibleCount).toBeGreaterThanOrEqual(5);
  });

  it('scaleValue clamps to a bounded range', () => {
    const vp = new Viewport(100, 20);
    for (let i = 0; i < 50; i++) vp.scaleValue(2); // would blow up without clamping
    expect(vp.valueScaleFactor).toBeLessThanOrEqual(8);

    for (let i = 0; i < 50; i++) vp.scaleValue(0.5);
    expect(vp.valueScaleFactor).toBeGreaterThanOrEqual(0.5);
  });

  it('panValueRange and scaleValueRange are no-ops until an override is set', () => {
    const vp = new Viewport(100, 20);
    vp.panValueRange(10);
    vp.scaleValueRange(2);
    expect(vp.valueRangeOverride).toBeNull();
  });

  it('panValueRange shifts both bounds by the same absolute amount', () => {
    const vp = new Viewport(100, 20);
    vp.setValueRangeOverride({ min: 100, max: 200 });
    vp.panValueRange(15);
    expect(vp.valueRangeOverride).toEqual({ min: 115, max: 215 });
  });

  it('scaleValueRange widens/narrows around the override range center', () => {
    const vp = new Viewport(100, 20);
    vp.setValueRangeOverride({ min: 100, max: 200 }); // center 150, half-span 50
    vp.scaleValueRange(2);
    expect(vp.valueRangeOverride).toEqual({ min: 50, max: 250 });
  });
});
