import { getCachedWasmModule } from '../wasm.js';
import type { WasmModule } from '../wasm.js';

/** Below this many input points, a pure-JS sliding-window sum is already
 * cheap enough that crossing into WASM would spend more time on the
 * JS<->WASM boundary than the computation itself — same reasoning as
 * `hybridScale.ts`'s `WASM_SCALE_THRESHOLD`. */
export const WASM_SMA_THRESHOLD = 500;

/**
 * Pure-JS simple moving average — a sliding-window sum, O(n). Produces
 * `NaN` for every index before the first full window, matching
 * `crates/cinderchart-core/src/lib.rs`'s `sma` exactly so callers get the
 * same result (and the same warm-up gap) regardless of which path
 * computed it.
 */
export function smaJs(values: number[], period: number): number[] {
  if (period <= 0 || values.length < period) {
    return values.map(() => NaN);
  }

  const out: number[] = [];
  let windowSum = 0;
  for (let i = 0; i < values.length; i++) {
    windowSum += values[i]!;
    if (i >= period) windowSum -= values[i - period]!;
    out.push(i + 1 < period ? NaN : windowSum / period);
  }
  return out;
}

/**
 * JS below `WASM_SMA_THRESHOLD` points, the compiled WASM `sma` above —
 * the same hybrid-dispatch idiom as `hybridScale.ts`'s `createScale`.
 * `wasmModule` defaults to whatever `loadWasm` has cached so far; pass it
 * explicitly in tests instead of depending on that module-level cache.
 */
export function computeSma(
  values: number[],
  period: number,
  wasmModule: WasmModule | null = getCachedWasmModule(),
): number[] {
  if (wasmModule && values.length >= WASM_SMA_THRESHOLD) {
    return Array.from(wasmModule.sma(Float64Array.from(values), period));
  }
  return smaJs(values, period);
}
