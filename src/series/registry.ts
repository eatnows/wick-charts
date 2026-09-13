import type { SeriesPoint } from '../types.js';
import type { SeriesDefinition } from './types.js';

/**
 * Keyed by `SeriesDefinition.type`. Deliberately untyped-at-rest
 * (`SeriesDefinition<any, any>`) — a registry that must hold arbitrarily
 * different point/style shapes side by side can't statically relate a
 * runtime string key to a specific `TPoint`/`TStyle` pair, so the type
 * safety is pushed to the two functions below instead: `registerSeries`
 * checks a definition against the type parameters it's called with, and
 * `getSeries`'s caller asserts what it expects back (exactly like
 * `JSON.parse`'s return type, or a DI container's `resolve<T>()`).
 */
const registry = new Map<string, SeriesDefinition<any, any>>();

/** Registers a series type, making it available to `new WickChart(canvas,
 * { type: definition.type })`. Call this once per definition — typically as
 * a module-level side effect in the file that defines it (see
 * `src/series/candlestick.ts`) so importing the module is enough to make
 * the type available. */
export function registerSeries<TPoint extends SeriesPoint, TStyle>(
  definition: SeriesDefinition<TPoint, TStyle>,
): void {
  registry.set(definition.type, definition);
}

/** Resolves a `type` string to its registered definition. Throws rather
 * than returning `undefined` — an unknown type is a caller mistake (typo,
 * or forgetting to import the module that registers it), not a state
 * `WickChart` should silently tolerate. */
export function getSeries<TPoint extends SeriesPoint, TStyle>(type: string): SeriesDefinition<TPoint, TStyle> {
  const definition = registry.get(type);
  if (!definition) {
    throw new Error(`wick-charts: unknown series type "${type}" — is it registered (registerSeries) and imported?`);
  }
  return definition as SeriesDefinition<TPoint, TStyle>;
}
