import { describe, expect, it } from 'vitest';
import { fitRange } from './priceRange';

describe('fitRange', () => {
  it('fits tightly around the raw min/max at scale factor 1', () => {
    const range = fitRange(90, 120, 1);
    expect(range.min).toBe(90);
    expect(range.max).toBe(120);
  });

  it('widens the range proportionally to the scale factor', () => {
    const range = fitRange(90, 110, 2);
    // mid = 100, raw half-span = 10, scaled half-span = 20
    expect(range.min).toBe(80);
    expect(range.max).toBe(120);
  });

  it('falls back to a non-zero span when min equals max', () => {
    const range = fitRange(100, 100, 1);
    expect(range.max).toBeGreaterThan(range.min);
  });
});
