import { describe, expect, it, vi } from 'vitest';
import { computeSma, smaJs, WASM_SMA_THRESHOLD } from './sma';
import type { WasmModule } from '../wasm';

function fakeWasmModule(): WasmModule & { smaSpy: ReturnType<typeof vi.fn> } {
  const smaSpy = vi.fn((closes: Float64Array, period: number) => Float64Array.from(smaJs(Array.from(closes), period)));
  return {
    default: vi.fn(async () => undefined),
    Scale: class {} as unknown as WasmModule['Scale'],
    sma: smaSpy,
    smaSpy,
  };
}

describe('smaJs', () => {
  it('is NaN before the first full window, then the sliding-window average', () => {
    const out = smaJs([1, 2, 3, 4, 5], 3);
    expect(out[0]).toBeNaN();
    expect(out[1]).toBeNaN();
    expect(out[2]).toBe(2); // (1+2+3)/3
    expect(out[3]).toBe(3); // (2+3+4)/3
    expect(out[4]).toBe(4); // (3+4+5)/3
  });

  it('is all NaN when the series is shorter than the period', () => {
    expect(smaJs([1, 2], 5)).toEqual([NaN, NaN]);
  });

  it('is all NaN for a zero period rather than dividing by zero', () => {
    expect(smaJs([1, 2, 3], 0)).toEqual([NaN, NaN, NaN]);
  });
});

describe('computeSma', () => {
  it('uses the JS path when no WASM module is available, regardless of length', () => {
    const values = Array.from({ length: WASM_SMA_THRESHOLD + 10 }, (_, i) => i);
    expect(computeSma(values, 5, null)).toEqual(smaJs(values, 5));
  });

  it('uses the JS path when under the WASM threshold even with a module available', () => {
    const wasm = fakeWasmModule();
    const values = Array.from({ length: WASM_SMA_THRESHOLD - 1 }, (_, i) => i);
    computeSma(values, 5, wasm);
    expect(wasm.smaSpy).not.toHaveBeenCalled();
  });

  it('uses the WASM path once length reaches the threshold, with the same result as the JS path', () => {
    const wasm = fakeWasmModule();
    const values = Array.from({ length: WASM_SMA_THRESHOLD }, (_, i) => i);
    const result = computeSma(values, 5, wasm);
    expect(wasm.smaSpy).toHaveBeenCalledOnce();
    expect(result).toEqual(smaJs(values, 5));
  });
});
