import { describe, expect, it } from 'vitest';
import {
  computeDonutArcs,
  computeDonutGeometry,
  donutAriaLabel,
  hitTestArc,
  paintedAngles,
  toCanvasRadians,
} from './layout';

const seg = (key: string, value: number, color?: string) => ({ key, label: key.toUpperCase(), value, color });

describe('computeDonutArcs', () => {
  it('spans the full sweep and fractions sum to 1', () => {
    const arcs = computeDonutArcs([seg('a', 1), seg('b', 1), seg('c', 2)]);
    expect(arcs.map((a) => a.fraction)).toEqual([0.25, 0.25, 0.5]);
    expect(arcs[0]!.startAngle).toBe(0);
    expect(arcs[2]!.endAngle).toBe(360);
    expect(arcs[1]!.startAngle).toBe(arcs[0]!.endAngle);
  });

  it('honors startAngle and sweep (gauge)', () => {
    const arcs = computeDonutArcs([seg('a', 1), seg('b', 1)], { startAngle: -90, sweep: 180 });
    expect(arcs[0]).toMatchObject({ startAngle: -90, endAngle: 0 });
    expect(arcs[1]).toMatchObject({ startAngle: 0, endAngle: 90 });
  });

  it('skips zero, negative and non-finite values and renormalizes', () => {
    const arcs = computeDonutArcs([seg('a', 0), seg('b', -1), seg('c', NaN), seg('d', Infinity), seg('e', 3), seg('f', 1)]);
    expect(arcs.map((a) => a.key)).toEqual(['e', 'f']);
    expect(arcs.map((a) => a.index)).toEqual([0, 1]);
    expect(arcs[0]!.fraction).toBe(0.75);
  });

  it('returns no arcs when nothing is valid', () => {
    expect(computeDonutArcs([])).toEqual([]);
    expect(computeDonutArcs([seg('a', 0)])).toEqual([]);
  });

  it('colors by input position so a skipped segment does not shift the rest', () => {
    const palette = ['red', 'green', 'blue'];
    const arcs = computeDonutArcs([seg('a', 1), seg('b', 0), seg('c', 1, 'pink')], { palette });
    expect(arcs.map((a) => a.color)).toEqual(['red', 'pink']);
    const wrap = computeDonutArcs([seg('a', 1), seg('b', 1), seg('c', 1), seg('d', 1)], { palette });
    expect(wrap[3]!.color).toBe('red');
  });
});

describe('computeDonutGeometry', () => {
  it('fits the smaller side minus padding and applies the inner ratio', () => {
    const g = computeDonutGeometry(300, 200, { innerRatio: 0.5, padding: 10, startAngle: 0, sweep: 360 });
    expect(g).toMatchObject({ cx: 150, cy: 100, outerRadius: 90, innerRadius: 45 });
  });

  it('gives a full pie at ratio 0, clamps out-of-range ratios, and never goes negative', () => {
    expect(computeDonutGeometry(100, 100, { innerRatio: 0, padding: 0, startAngle: 0, sweep: 360 }).innerRadius).toBe(0);
    expect(computeDonutGeometry(100, 100, { innerRatio: 5, padding: 0, startAngle: 0, sweep: 360 }).innerRadius).toBe(50);
    expect(computeDonutGeometry(10, 10, { innerRatio: 0.5, padding: 50, startAngle: 0, sweep: 360 }).outerRadius).toBe(0);
  });
});

describe('paintedAngles', () => {
  const geometry = computeDonutGeometry(200, 200, { innerRatio: 0.5, padding: 0, startAngle: 0, sweep: 360 });

  it('carves half the gap off each side', () => {
    const { start, end } = paintedAngles({ startAngle: 0, endAngle: 90 }, 4, 4, geometry);
    // mid radius 75px: 4px ≈ 3.056°
    expect(start).toBeCloseTo(1.528, 2);
    expect(end).toBeCloseTo(90 - 1.528, 2);
  });

  it('does not gap a lone arc or when gap is 0', () => {
    expect(paintedAngles({ startAngle: 0, endAngle: 360 }, 1, 4, geometry)).toEqual({ start: 0, end: 360 });
    expect(paintedAngles({ startAngle: 0, endAngle: 90 }, 4, 0, geometry)).toEqual({ start: 0, end: 90 });
  });

  it('never eats more than half of a tiny arc', () => {
    const { start, end } = paintedAngles({ startAngle: 0, endAngle: 1 }, 4, 20, geometry);
    expect(end - start).toBeCloseTo(0.5, 5);
  });
});

describe('hitTestArc', () => {
  const arcs = computeDonutArcs([seg('a', 1), seg('b', 1), seg('c', 2)]); // a: 0-90 (NE), b: 90-180 (SE), c: 180-360
  const g = computeDonutGeometry(200, 200, { innerRatio: 0.5, padding: 0, startAngle: 0, sweep: 360 });

  it('finds the arc by angle, clockwise from 12 o’clock', () => {
    expect(hitTestArc(arcs, g, 140, 60)?.key).toBe('a'); // up-right
    expect(hitTestArc(arcs, g, 140, 140)?.key).toBe('b'); // down-right
    expect(hitTestArc(arcs, g, 60, 140)?.key).toBe('c'); // down-left
    expect(hitTestArc(arcs, g, 60, 60)?.key).toBe('c'); // up-left
  });

  it('returns null in the hole and outside the ring', () => {
    expect(hitTestArc(arcs, g, 100, 100)).toBeNull();
    expect(hitTestArc(arcs, g, 100, 20)?.key).toBe('a'); // straight up = 0°, the first arc's start
    expect(hitTestArc(arcs, g, 199, 199)).toBeNull();
  });

  it('is null in a gauge’s empty remainder', () => {
    const gauge = computeDonutGeometry(200, 200, { innerRatio: 0.5, padding: 0, startAngle: -90, sweep: 180 });
    const half = computeDonutArcs([seg('a', 1), seg('b', 1)], { startAngle: -90, sweep: 180 });
    expect(hitTestArc(half, gauge, 100, 20)?.key).toBe('b'); // 12 o'clock = middle of the sweep, start of b
    expect(hitTestArc(half, gauge, 100, 180)).toBeNull(); // bottom: outside the upper half-ring
    expect(hitTestArc(half, gauge, 20, 100)?.key).toBe('a'); // 9 o'clock = sweep start
  });
});

describe('misc', () => {
  it('converts to canvas radians (12 o’clock = -π/2)', () => {
    expect(toCanvasRadians(0)).toBeCloseTo(-Math.PI / 2);
    expect(toCanvasRadians(90)).toBeCloseTo(0);
  });

  it('builds the aria label from labels and formatted percents', () => {
    const arcs = computeDonutArcs([seg('a', 1), seg('b', 3)]);
    expect(donutAriaLabel(arcs, (f) => `${(f * 100).toFixed(1)}%`)).toBe('A 25.0%, B 75.0%');
    expect(donutAriaLabel([], () => '')).toBe('No data');
  });
});
