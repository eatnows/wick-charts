import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCachedWasmModule, loadWasm, resetWasmForTesting } from './wasm';
import type { WasmModule } from './wasm';

function fakeModule(): WasmModule {
  return {
    default: vi.fn(async () => undefined),
    Scale: class {
      constructor(
        public a: number,
        public b: number,
        public c: number,
        public d: number,
      ) {}
      map(value: number) {
        return value;
      }
      map_many(values: Float64Array) {
        return values;
      }
      free() {}
    } as unknown as WasmModule['Scale'],
  };
}

describe('loadWasm', () => {
  beforeEach(() => {
    resetWasmForTesting();
  });

  it('resolves with the module and calls its init function', async () => {
    const mod = fakeModule();
    const importer = vi.fn(async () => mod);
    const result = await loadWasm(importer);
    expect(result).toBe(mod);
    expect(mod.default).toHaveBeenCalledOnce();
  });

  it('caches the module for getCachedWasmModule after loading resolves', async () => {
    expect(getCachedWasmModule()).toBeNull();
    await loadWasm(async () => fakeModule());
    expect(getCachedWasmModule()).not.toBeNull();
  });

  it('resolves to null instead of throwing when the importer rejects', async () => {
    const importer = vi.fn(async () => {
      throw new Error('no wasm support');
    });
    const result = await loadWasm(importer);
    expect(result).toBeNull();
    expect(getCachedWasmModule()).toBeNull();
  });

  it('reuses the in-flight promise instead of importing twice', async () => {
    const importer = vi.fn(async () => fakeModule());
    const [a, b] = await Promise.all([loadWasm(importer), loadWasm(importer)]);
    expect(a).toBe(b);
    expect(importer).toHaveBeenCalledOnce();
  });
});
