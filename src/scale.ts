/**
 * JS placeholder for domain→pixel scaling.
 *
 * This mirrors `Scale` in crates/cinderchart-core/src/lib.rs exactly. It's
 * the seam where the WASM build gets wired in: once the crate is compiled
 * with wasm-pack and published as an internal dependency, `LinearScale`
 * gets replaced by a thin wrapper around the WASM `Scale` for series above
 * whatever point size profiling says the JS↔WASM call overhead pays for
 * itself. Small series stay on this plain implementation — there's no
 * reason to pay a WASM boundary cost to scale a handful of points.
 */
export class LinearScale {
  constructor(
    private domainMin: number,
    private domainMax: number,
    private rangeMin: number,
    private rangeMax: number,
  ) {}

  map(value: number): number {
    const span = this.domainMax - this.domainMin;
    if (span === 0) return this.rangeMin;
    const t = (value - this.domainMin) / span;
    return this.rangeMin + t * (this.rangeMax - this.rangeMin);
  }

  mapMany(values: number[]): number[] {
    return values.map((v) => this.map(v));
  }
}
