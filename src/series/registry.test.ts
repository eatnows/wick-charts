import { describe, expect, it } from 'vitest';
import { getSeries, registerSeries } from './registry';
import type { SeriesDefinition } from './types';
import type { SeriesPoint } from '../types';

interface DummyPoint extends SeriesPoint {
  value: number;
}

describe('series registry', () => {
  it('resolves a definition by the type it was registered under', () => {
    const definition: SeriesDefinition<DummyPoint, { color: string }> = {
      type: 'dummy-a',
      defaultStyle: { color: 'red' },
      getValueRange: (visible) => ({ min: 0, max: visible.length }),
      draw: () => {},
    };
    registerSeries(definition);
    expect(getSeries('dummy-a')).toBe(definition);
  });

  it('throws with a helpful message for an unregistered type', () => {
    expect(() => getSeries('does-not-exist')).toThrow(/unknown series type/);
  });

  it('lets a later registration replace an earlier one under the same type key', () => {
    const first: SeriesDefinition<DummyPoint, unknown> = {
      type: 'dummy-b',
      defaultStyle: {},
      getValueRange: () => ({ min: 0, max: 1 }),
      draw: () => {},
    };
    const second: SeriesDefinition<DummyPoint, unknown> = { ...first, defaultStyle: { replaced: true } };
    registerSeries(first);
    registerSeries(second);
    expect(getSeries('dummy-b')).toBe(second);
  });
});
