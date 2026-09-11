import { describe, expect, it } from 'vitest';
import { formatAxisLabel, pickTickIndices } from './axis';

describe('formatAxisLabel', () => {
  const t = Date.parse('2026-09-11T14:30:00Z') / 1000;

  it('shows HH:mm when the span is a day or less', () => {
    expect(formatAxisLabel(t, 3600)).toBe('14:30');
  });

  it('shows MM-DD when the span is between a day and 90 days', () => {
    expect(formatAxisLabel(t, 30 * 86_400)).toBe('09-11');
  });

  it('shows YYYY-MM when the span exceeds 90 days', () => {
    expect(formatAxisLabel(t, 400 * 86_400)).toBe('2026-09');
  });
});

describe('pickTickIndices', () => {
  it('returns every index when length is under the cap', () => {
    expect(pickTickIndices(4, 6)).toEqual([0, 1, 2, 3]);
  });

  it('returns an empty array for an empty series', () => {
    expect(pickTickIndices(0, 6)).toEqual([]);
  });

  it('spreads ticks evenly and always includes the first and last index', () => {
    const ticks = pickTickIndices(100, 5);
    expect(ticks[0]).toBe(0);
    expect(ticks[ticks.length - 1]).toBe(99);
    expect(ticks.length).toBeLessThanOrEqual(5);
  });
});
