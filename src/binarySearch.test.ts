import { describe, expect, it } from 'vitest';
import { lowerBound, upperBound } from './binarySearch';

describe('lowerBound', () => {
  it('finds the first index >= target', () => {
    expect(lowerBound([10, 20, 30, 40], 25)).toBe(2);
  });

  it('finds an exact match at its own index', () => {
    expect(lowerBound([10, 20, 30, 40], 20)).toBe(1);
  });

  it('returns 0 when target is before every value', () => {
    expect(lowerBound([10, 20, 30], 5)).toBe(0);
  });

  it('returns length when target is after every value', () => {
    expect(lowerBound([10, 20, 30], 100)).toBe(3);
  });

  it('returns 0 for an empty array', () => {
    expect(lowerBound([], 5)).toBe(0);
  });

  it('handles duplicate values by returning the first occurrence', () => {
    expect(lowerBound([10, 20, 20, 20, 30], 20)).toBe(1);
  });
});

describe('upperBound', () => {
  it('finds the first index > target', () => {
    expect(upperBound([10, 20, 30, 40], 25)).toBe(2);
  });

  it('skips past an exact match to the next index', () => {
    expect(upperBound([10, 20, 30, 40], 20)).toBe(2);
  });

  it('returns 0 when target is before every value', () => {
    expect(upperBound([10, 20, 30], 5)).toBe(0);
  });

  it('returns length when target is after every value', () => {
    expect(upperBound([10, 20, 30], 100)).toBe(3);
  });

  it('handles duplicate values by returning one past the last occurrence', () => {
    expect(upperBound([10, 20, 20, 20, 30], 20)).toBe(4);
  });

  it('[lowerBound(from), upperBound(to)) includes every value in [from, to] inclusive', () => {
    const values = [10, 20, 30, 40, 50];
    const start = lowerBound(values, 20);
    const end = upperBound(values, 40);
    expect(values.slice(start, end)).toEqual([20, 30, 40]);
  });
});
