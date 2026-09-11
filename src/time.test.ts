import { describe, expect, it } from 'vitest';
import { toUnixSeconds } from './time';

describe('toUnixSeconds', () => {
  it('treats a bare number as unix seconds', () => {
    expect(toUnixSeconds(1_700_000_000)).toBe(1_700_000_000);
  });

  it('converts { unixMs } to seconds', () => {
    expect(toUnixSeconds({ unixMs: 1_700_000_000_000 })).toBe(1_700_000_000);
  });

  it('converts { businessDay } to UTC-midnight unix seconds', () => {
    const seconds = toUnixSeconds({ businessDay: { year: 2026, month: 9, day: 11 } });
    expect(new Date(seconds * 1000).toISOString()).toBe('2026-09-11T00:00:00.000Z');
  });

  it('parses an ISO 8601 string', () => {
    const seconds = toUnixSeconds('2026-09-11T00:00:00Z');
    expect(new Date(seconds * 1000).toISOString()).toBe('2026-09-11T00:00:00.000Z');
  });

  it('throws on an unparseable string', () => {
    expect(() => toUnixSeconds('not-a-date')).toThrow(/could not parse/);
  });

  it('throws on a non-finite number', () => {
    expect(() => toUnixSeconds(Number.NaN)).toThrow(/non-finite/);
  });
});
