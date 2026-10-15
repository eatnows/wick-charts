import { describe, expect, it } from 'vitest';
import { drawLegendBox, toSegments } from './legendBox';
import { createFakeContext } from './testHelpers';
import type { ChartFontOptions, ChartLegendOptions } from './types';

const LEGEND: Required<ChartLegendOptions> = {
  textColor: '#f0f0f0',
  background: '#3a3a3a',
  paddingX: 8,
  paddingY: 6,
  cursorGap: 12,
};
const FONT: Required<ChartFontOptions> = { family: 'sans-serif', axisSize: 10, legendSize: 11 };
const BOUNDS = { width: 700, height: 300 };

// The fake ctx's measureText always returns width 40, so a one-line,
// one-segment box is 40 + 2*8 = 56 wide and 1*15 + 2*6 = 27 tall.
function draw(anchor: { x: number; y: number }, lines: string[] = ['Value 1'], bounds = BOUNDS) {
  const ctx = createFakeContext();
  const rect = drawLegendBox(ctx as unknown as CanvasRenderingContext2D, lines, anchor, bounds, LEGEND, FONT);
  return { ctx, rect };
}

describe('toSegments', () => {
  it('normalizes string, single segment, and segment-array lines', () => {
    expect(toSegments('a')).toEqual([{ text: 'a' }]);
    expect(toSegments({ text: 'a', color: 'red' })).toEqual([{ text: 'a', color: 'red' }]);
    expect(toSegments([{ text: 'a' }, { text: 'b', color: 'red' }])).toHaveLength(2);
  });
});

describe('drawLegendBox', () => {
  it('floats up-and-right of the anchor by cursorGap', () => {
    const { rect } = draw({ x: 100, y: 200 });
    expect(rect).toEqual({ left: 112, top: 200 - 27 - 12, width: 56, height: 27 });
  });

  it('clamps to the left/top edges', () => {
    const { rect } = draw({ x: -50, y: 5 });
    expect(rect.left).toBe(0);
    expect(rect.top).toBe(0);
  });

  it('clamps to the right/bottom edges', () => {
    const { rect } = draw({ x: 9999, y: 9999 });
    expect(rect.left).toBe(BOUNDS.width - 56);
    expect(rect.top).toBe(BOUNDS.height - 27);
  });

  it('pins to 0 when the box is larger than the bounds', () => {
    const { rect } = draw({ x: 10, y: 10 }, ['x'], { width: 20, height: 10 });
    expect(rect.left).toBe(0);
    expect(rect.top).toBe(0);
  });

  it('sizes the box by line count and draws each segment in its own color', () => {
    const ctx = createFakeContext();
    const rect = drawLegendBox(
      ctx as unknown as CanvasRenderingContext2D,
      ['a', [{ text: 'b' }, { text: 'c', color: 'lime' }]],
      { x: 100, y: 200 },
      BOUNDS,
      LEGEND,
      FONT,
    );
    expect(rect.height).toBe(2 * 15 + 12);
    expect(rect.width).toBe(80 + 16); // widest line = two 40-wide segments
    expect(ctx.fillText).toHaveBeenCalledTimes(3);
    expect(ctx.fillStyle).toBe('lime'); // last segment drawn last
  });
});
