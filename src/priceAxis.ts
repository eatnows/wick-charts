/** Rounds `range` to a "nice" 1/2/5×10^n value — the classic Heckbert
 * nice-numbers step used by every axis-tick generator (d3 included). */
function niceNumber(range: number, round: boolean): number {
  const exponent = Math.floor(Math.log10(range));
  const fraction = range / 10 ** exponent;
  let niceFraction: number;

  if (round) {
    if (fraction < 1.5) niceFraction = 1;
    else if (fraction < 3) niceFraction = 2;
    else if (fraction < 7) niceFraction = 5;
    else niceFraction = 10;
  } else {
    if (fraction <= 1) niceFraction = 1;
    else if (fraction <= 2) niceFraction = 2;
    else if (fraction <= 5) niceFraction = 5;
    else niceFraction = 10;
  }

  return niceFraction * 10 ** exponent;
}

/** Generates ~`targetCount` evenly-spaced, human-friendly tick values
 * covering [min, max] — e.g. 71000, 71500, 72000 rather than the raw
 * fractional steps a naive linear split would produce. */
export function niceTicks(min: number, max: number, targetCount: number): number[] {
  if (min === max) return [min];

  const step = niceNumber((max - min) / Math.max(1, targetCount - 1), true);
  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;

  const ticks: number[] = [];
  for (let v = niceMin; v <= niceMax + step * 0.5; v += step) {
    ticks.push(Math.round(v * 1e8) / 1e8); // strip float noise
  }
  return ticks;
}

/** Formats a price with a decimal count inferred from the tick step, so
 * 0.5-step ticks show "71000.5" and 100-step ticks show "71000". */
export function formatPrice(value: number, step: number): string {
  const decimals = step > 0 && step < 1 ? Math.max(0, -Math.floor(Math.log10(step))) : 0;
  return value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
