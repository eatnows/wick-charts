/** Shape of the compiled cinderchart-core WASM module as exposed by its
 * wasm-bindgen bindings: a `default` init function plus the same `Scale`
 * class the Rust crate defines. */
export interface WasmModule {
  default: (input?: unknown) => Promise<unknown>;
  Scale: new (domainMin: number, domainMax: number, rangeMin: number, rangeMax: number) => {
    map(value: number): number;
    map_many(values: Float64Array): Float64Array;
    free(): void;
  };
}

export type WasmImporter = () => Promise<WasmModule>;

let modulePromise: Promise<WasmModule | null> | null = null;
let cached: WasmModule | null = null;

/**
 * Kicks off loading and initializing the compiled WASM module in the
 * background. Never throws — an environment without WASM support, a
 * blocked fetch, or any other failure just means every caller keeps using
 * the JS fallback instead. Safe to call repeatedly: the in-flight or
 * already-resolved promise is reused rather than re-fetching.
 */
export function loadWasm(importer: WasmImporter): Promise<WasmModule | null> {
  if (!modulePromise) {
    modulePromise = importer()
      .then(async (mod) => {
        await mod.default();
        cached = mod;
        return mod;
      })
      .catch(() => null);
  }
  return modulePromise;
}

/** Synchronous read of whatever `loadWasm` has resolved so far — `null`
 * both before loading finishes and if it failed. Callers on a synchronous
 * hot path (the renderer can't `await` mid-frame) read this instead of
 * awaiting `loadWasm` directly. */
export function getCachedWasmModule(): WasmModule | null {
  return cached;
}

/** Test-only escape hatch: clears the module-level cache so each test can
 * exercise `loadWasm` from a clean slate instead of sharing one promise
 * across the whole suite. */
export function resetWasmForTesting(): void {
  modulePromise = null;
  cached = null;
}
