import { LinearScale } from './scale.js';
import { getCachedWasmModule } from './wasm.js';
import type { WasmModule } from './wasm.js';

/** Below this many points, a `LinearScale.mapMany` call is already just a
 * handful of multiplications — crossing into WASM would spend more time on
 * the JS↔WASM boundary than the JS version spends on the whole computation. */
export const WASM_SCALE_THRESHOLD = 500;

export interface Scale {
  map(value: number): number;
  mapMany(values: number[]): number[];
}

/** A `Scale` backed by a `wasm-bindgen`-generated instance, freeing its
 * WASM-side memory via `dispose()` — callers must call this once done
 * (the renderer does so in a `finally`) since nothing else will. */
class WasmBackedScale implements Scale {
  private inner: InstanceType<WasmModule['Scale']>;

  constructor(wasm: WasmModule, domainMin: number, domainMax: number, rangeMin: number, rangeMax: number) {
    this.inner = new wasm.Scale(domainMin, domainMax, rangeMin, rangeMax);
  }

  map(value: number): number {
    return this.inner.map(value);
  }

  mapMany(values: number[]): number[] {
    return Array.from(this.inner.map_many(Float64Array.from(values)));
  }

  dispose(): void {
    this.inner.free();
  }
}

export interface DisposableScale {
  scale: Scale;
  dispose(): void;
}

/**
 * Picks JS or WASM for a domain→range mapping based on how many points
 * will go through it. `wasmModule` defaults to whatever `loadWasm` (see
 * wasm.ts) has cached so far — pass it explicitly in tests instead of
 * depending on that module-level cache.
 *
 * Always returns a `dispose()` — a no-op for the JS path, a real WASM
 * memory free for the WASM path — so call sites can treat both uniformly
 * (`try { ... } finally { result.dispose() }`) without branching on which
 * one they got.
 */
export function createScale(
  domainMin: number,
  domainMax: number,
  rangeMin: number,
  rangeMax: number,
  pointCount: number,
  wasmModule: WasmModule | null = getCachedWasmModule(),
): DisposableScale {
  if (wasmModule && pointCount >= WASM_SCALE_THRESHOLD) {
    const scale = new WasmBackedScale(wasmModule, domainMin, domainMax, rangeMin, rangeMax);
    return { scale, dispose: () => scale.dispose() };
  }

  return { scale: new LinearScale(domainMin, domainMax, rangeMin, rangeMax), dispose: () => {} };
}
