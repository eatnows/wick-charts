import { describe, expect, it } from 'vitest';
import { LinearScale } from './scale';

describe('LinearScale', () => {
  it('maps domain edges to range edges', () => {
    const scale = new LinearScale(0, 100, 400, 0);
    expect(scale.map(0)).toBe(400);
    expect(scale.map(100)).toBe(0);
    expect(scale.map(50)).toBe(200);
  });

  it('handles a zero-width domain without dividing by zero', () => {
    const scale = new LinearScale(50, 50, 0, 400);
    expect(scale.map(50)).toBe(0);
  });

  it('maps a series in order', () => {
    const scale = new LinearScale(0, 10, 0, 100);
    expect(scale.mapMany([0, 5, 10])).toEqual([0, 50, 100]);
  });
});
