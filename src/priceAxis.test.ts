import { describe, expect, it } from 'vitest';
import { formatPrice, niceTicks } from './priceAxis';

describe('niceTicks', () => {
  it('produces round steps covering the range', () => {
    const ticks = niceTicks(71_230, 76_840, 5);
    // step should be a "nice" number like 1000 or 2000, not something ugly
    const step = ticks[1]! - ticks[0]!;
    expect([500, 1000, 2000, 2500, 5000]).toContain(step);
    expect(ticks[0]!).toBeLessThanOrEqual(71_230);
    expect(ticks[ticks.length - 1]!).toBeGreaterThanOrEqual(76_840);
  });

  it('returns a single tick when min equals max', () => {
    expect(niceTicks(100, 100, 5)).toEqual([100]);
  });
});

describe('formatPrice', () => {
  it('shows no decimals for integer-scale steps', () => {
    expect(formatPrice(71000, 1000)).toBe('71,000');
  });

  it('shows decimals matching a fractional step', () => {
    expect(formatPrice(71000.5, 0.5)).toBe('71,000.5');
  });
});
