import { describe, expect, it } from 'vitest';
import { AxisRenderer } from './axisRenderer';
import { createFakeContext } from './testHelpers';
import type { FakeContext2D } from './testHelpers';
import type { ChartAxisOptions, ChartFontOptions } from './types';

const AXIS: Required<ChartAxisOptions> = {
  priceWidth: 64,
  timeHeight: 24,
  priceTickCount: 5,
  timeMaxTicks: 6,
  textColor: '#787878',
  lineColor: '#333333',
  gridLineColor: '#2a2a2a',
};

const FONT: Required<ChartFontOptions> = { family: 'sans-serif', axisSize: 10, legendSize: 11 };

function identityScale() {
  return { map: (v: number) => v, mapMany: (vs: number[]) => vs };
}

function makeRenderer(ctx: FakeContext2D): AxisRenderer {
  return new AxisRenderer(ctx as unknown as CanvasRenderingContext2D, AXIS, FONT);
}

describe('AxisRenderer', () => {
  // Constructed standalone, with no ChartRenderer/canvas/series involved —
  // exercising exactly the decoupling the split from ChartRenderer was for.

  describe('priceStep', () => {
    it('derives a step from adjacent nice ticks', () => {
      const renderer = makeRenderer(createFakeContext());
      expect(renderer.priceStep(0, 100)).toBeGreaterThan(0);
    });

    it('returns 0 when the range collapses to a single tick', () => {
      const renderer = makeRenderer(createFakeContext());
      expect(renderer.priceStep(50, 50)).toBe(0);
    });
  });

  describe('renderPriceAxis', () => {
    it('draws the boundary line offset by topOffset, spanning exactly chartHeight', () => {
      const ctx = createFakeContext();
      const renderer = makeRenderer(ctx);
      renderer.renderPriceAxis(0, 100, 10, identityScale(), 700, 200, 50);

      expect(ctx.moveTo).toHaveBeenCalledWith(700.5, 50);
      expect(ctx.lineTo).toHaveBeenCalledWith(700.5, 250); // topOffset + chartHeight
    });

    it('skips a tick whose mapped position falls outside [0, chartHeight]', () => {
      const ctx = createFakeContext();
      const renderer = makeRenderer(ctx);
      // A scale that always maps outside the pane — no tick should draw text.
      const outOfRangeScale = { map: () => -50, mapMany: (vs: number[]) => vs.map(() => -50) };
      renderer.renderPriceAxis(0, 100, 10, outOfRangeScale, 700, 200, 0);
      expect(ctx.fillText).not.toHaveBeenCalled();
    });
  });

  describe('renderPaneSeparator', () => {
    it('draws a horizontal line at the given top', () => {
      const ctx = createFakeContext();
      const renderer = makeRenderer(ctx);
      renderer.renderPaneSeparator(300, 700);
      expect(ctx.moveTo).toHaveBeenCalledWith(0, 300.5);
      expect(ctx.lineTo).toHaveBeenCalledWith(700, 300.5);
    });
  });

  describe('renderTimeAxis', () => {
    it('draws the boundary line at chartHeight and at least one tick label', () => {
      const ctx = createFakeContext();
      const renderer = makeRenderer(ctx);
      const times = [1, 2, 3, 4, 5];
      renderer.renderTimeAxis(times, 0, 5, 200, 700, (i) => i * 10);

      expect(ctx.moveTo).toHaveBeenCalledWith(0, 200.5);
      expect(ctx.lineTo).toHaveBeenCalledWith(700, 200.5);
      expect(ctx.fillText).toHaveBeenCalled();
    });
  });
});
