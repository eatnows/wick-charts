import { describe, expect, it } from 'vitest';
import { distanceToSegment, hitTestPoint, hitTestSegment } from './hitTest';

describe('distanceToSegment', () => {
  it('is zero for a point on the segment', () => {
    expect(distanceToSegment(5, 0, 0, 0, 10, 0)).toBe(0);
  });

  it('measures perpendicular distance to a point beside the segment', () => {
    expect(distanceToSegment(5, 3, 0, 0, 10, 0)).toBe(3);
  });

  it('clamps to the nearest endpoint when the point is beyond either end', () => {
    // straight off the right end, not the infinite line through it
    expect(distanceToSegment(15, 0, 0, 0, 10, 0)).toBe(5);
    // straight off the left end
    expect(distanceToSegment(-4, 0, 0, 0, 10, 0)).toBe(4);
  });

  it('treats a zero-length segment as a single point', () => {
    expect(distanceToSegment(3, 4, 0, 0, 0, 0)).toBe(5);
  });

  it('works for a diagonal segment, not just axis-aligned ones', () => {
    // (0,0)-(6,8): length 10. Perpendicular foot from (3,4) lands on the
    // segment itself since (3,4) is the segment's own midpoint.
    expect(distanceToSegment(3, 4, 0, 0, 6, 8)).toBe(0);
  });
});

describe('hitTestSegment', () => {
  it('is true within the default tolerance', () => {
    expect(hitTestSegment(5, 5, 0, 0, 10, 0)).toBe(true); // 5px away, default tolerance 6
  });

  it('is false outside the default tolerance', () => {
    expect(hitTestSegment(5, 10, 0, 0, 10, 0)).toBe(false); // 10px away
  });

  it('respects a custom tolerance', () => {
    expect(hitTestSegment(5, 10, 0, 0, 10, 0, 12)).toBe(true);
    expect(hitTestSegment(5, 10, 0, 0, 10, 0, 2)).toBe(false);
  });
});

describe('hitTestPoint', () => {
  it('is true within the default tolerance', () => {
    expect(hitTestPoint(3, 4, 0, 0)).toBe(true); // distance 5, default tolerance 6
  });

  it('is false outside the default tolerance', () => {
    expect(hitTestPoint(6, 8, 0, 0)).toBe(false); // distance 10
  });

  it('respects a custom tolerance', () => {
    expect(hitTestPoint(6, 8, 0, 0, 10)).toBe(true);
    expect(hitTestPoint(6, 8, 0, 0, 2)).toBe(false);
  });
});
