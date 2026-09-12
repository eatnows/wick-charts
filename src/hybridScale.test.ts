import { describe, expect, it, vi } from 'vitest';
import { createScale, WASM_SCALE_THRESHOLD } from './hybridScale';
import { LinearScale } from './scale';
import type { WasmModule } from './wasm';

function fakeWasmModule(): WasmModule & { freeSpy: ReturnType<typeof vi.fn> } {
  const freeSpy = vi.fn();
  const ScaleCtor = class {
    constructor(
      private domainMin: number,
      private domainMax: number,
      private rangeMin: number,
      private rangeMax: number,
    ) {}
    map(value: number) {
      // delegate to the real linear-scale math so the fake is behaviorally correct
      return new LinearScale(this.domainMin, this.domainMax, this.rangeMin, this.rangeMax).map(value);
    }
    map_many(values: Float64Array) {
      return Float64Array.from(
        new LinearScale(this.domainMin, this.domainMax, this.rangeMin, this.rangeMax).mapMany(Array.from(values)),
      );
    }
    free() {
      freeSpy();
    }
  };
  return {
    default: vi.fn(async () => undefined),
    Scale: ScaleCtor as unknown as WasmModule['Scale'],
    freeSpy,
  };
}

describe('createScale', () => {
  it('uses the JS scale when no WASM module is available, regardless of point count', () => {
    const { scale, dispose } = createScale(0, 100, 400, 0, 10_000, null);
    expect(scale).toBeInstanceOf(LinearScale);
    expect(() => dispose()).not.toThrow(); // JS path's dispose is a no-op
  });

  it('uses the JS scale when a WASM module is available but the point count is under the threshold', () => {
    const wasm = fakeWasmModule();
    const { scale } = createScale(0, 100, 400, 0, WASM_SCALE_THRESHOLD - 1, wasm);
    expect(scale).toBeInstanceOf(LinearScale);
  });

  it('uses the WASM scale once the point count reaches the threshold', () => {
    const wasm = fakeWasmModule();
    const { scale, dispose } = createScale(0, 100, 400, 0, WASM_SCALE_THRESHOLD, wasm);
    expect(scale).not.toBeInstanceOf(LinearScale);
    expect(scale.map(50)).toBe(200); // same math as LinearScale, just routed through the fake WASM instance
    dispose();
    expect(wasm.freeSpy).toHaveBeenCalledOnce();
  });

  it('mapMany on the WASM path round-trips through Float64Array correctly', () => {
    const wasm = fakeWasmModule();
    const { scale, dispose } = createScale(0, 10, 0, 100, WASM_SCALE_THRESHOLD, wasm);
    expect(scale.mapMany([0, 5, 10])).toEqual([0, 50, 100]);
    dispose();
  });
});
