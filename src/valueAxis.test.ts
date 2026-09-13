import { describe, expect, it } from 'vitest';
import { pixelToValue, valueAxisPixelRange, valueToPixel } from './valueAxis';

describe('valueAxisPixelRange', () => {
  it('puts the domain maximum at pixel 0 (top) when not inverted', () => {
    expect(valueAxisPixelRange(400, false)).toEqual([400, 0]);
  });

  it('swaps the endpoints when inverted', () => {
    expect(valueAxisPixelRange(400, true)).toEqual([0, 400]);
  });
});

describe('valueToPixel / pixelToValue', () => {
  const valueMin = 100;
  const valueMax = 200;
  const pixelSpan = 400;

  it('not inverted: the max value renders at pixel 0, the min at pixelSpan', () => {
    expect(valueToPixel(valueMax, valueMin, valueMax, pixelSpan, false)).toBe(0);
    expect(valueToPixel(valueMin, valueMin, valueMax, pixelSpan, false)).toBe(pixelSpan);
    expect(valueToPixel(150, valueMin, valueMax, pixelSpan, false)).toBe(pixelSpan / 2);
  });

  it('inverted: the min value renders at pixel 0, the max at pixelSpan', () => {
    expect(valueToPixel(valueMin, valueMin, valueMax, pixelSpan, true)).toBe(0);
    expect(valueToPixel(valueMax, valueMin, valueMax, pixelSpan, true)).toBe(pixelSpan);
    expect(valueToPixel(150, valueMin, valueMax, pixelSpan, true)).toBe(pixelSpan / 2);
  });

  it('pixelToValue is the exact inverse of valueToPixel, not inverted', () => {
    for (const value of [100, 123.4, 150, 199.9, 200]) {
      const pixel = valueToPixel(value, valueMin, valueMax, pixelSpan, false);
      expect(pixelToValue(pixel, valueMin, valueMax, pixelSpan, false)).toBeCloseTo(value, 10);
    }
  });

  it('pixelToValue is the exact inverse of valueToPixel, inverted', () => {
    for (const value of [100, 123.4, 150, 199.9, 200]) {
      const pixel = valueToPixel(value, valueMin, valueMax, pixelSpan, true);
      expect(pixelToValue(pixel, valueMin, valueMax, pixelSpan, true)).toBeCloseTo(value, 10);
    }
  });

  it('inverted and non-inverted pixelToValue give opposite-direction results for the same pixel', () => {
    const pixel = 100; // a quarter of the way down pixelSpan=400
    const normal = pixelToValue(pixel, valueMin, valueMax, pixelSpan, false);
    const inverted = pixelToValue(pixel, valueMin, valueMax, pixelSpan, true);
    // normal: 3/4 toward max (75); inverted: 1/4 toward max (25) — mirror images
    expect(normal).toBeCloseTo(175, 10);
    expect(inverted).toBeCloseTo(125, 10);
  });
});
