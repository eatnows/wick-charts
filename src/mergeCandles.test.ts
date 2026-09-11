import { describe, expect, it } from 'vitest';
import { mergeCandles } from './mergeCandles';
import type { Candle } from './types';

function candle(time: number, close: number): Candle {
  return { time, open: close, high: close, low: close, close };
}

describe('mergeCandles', () => {
  it('sorts the combined result ascending by time', () => {
    const existing = [candle(300, 1), candle(100, 2)];
    const incoming = [candle(200, 3)];
    const merged = mergeCandles(existing, incoming);
    expect(merged.map((c) => c.time)).toEqual([100, 200, 300]);
  });

  it('prefers the incoming candle when times overlap', () => {
    const existing = [candle(100, 1)];
    const incoming = [candle(100, 999)];
    const merged = mergeCandles(existing, incoming);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.close).toBe(999);
  });

  it('handles a batch that fully overlaps already-loaded data', () => {
    const existing = [candle(100, 1), candle(200, 2), candle(300, 3)];
    const incoming = [candle(100, 1), candle(200, 2)]; // re-fetched overlap, no new candles
    const merged = mergeCandles(existing, incoming);
    expect(merged).toHaveLength(3);
  });

  it('returns existing unchanged when incoming is empty', () => {
    const existing = [candle(100, 1)];
    expect(mergeCandles(existing, [])).toEqual(existing);
  });
});
