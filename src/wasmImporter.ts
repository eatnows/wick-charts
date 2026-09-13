import type { WasmModule } from './wasm.js';

/** The real dynamic import of the wasm-pack build output — kept as a
 * one-line seam so `loadWasm` (see wasm.ts) can be unit tested with a fake
 * importer instead of needing an actual `.wasm` binary in the test run.
 * Regenerate the target with `pnpm build:wasm`. */
export function importRealWasm(): Promise<WasmModule> {
  return import('../wasm-pkg/wickchart_core.js') as unknown as Promise<WasmModule>;
}
