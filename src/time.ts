import type { BusinessDay, CinderTime, UnixMillis } from './types.js';

/** One recognized `CinderTime` shape: how to detect it, how to normalize it. */
interface TimeStrategy {
  name: string;
  test(time: CinderTime): boolean;
  toUnixSeconds(time: CinderTime): number;
}

function isUnixMillis(time: CinderTime): time is UnixMillis {
  return typeof time === 'object' && time !== null && 'unixMs' in time;
}

function isBusinessDay(time: CinderTime): time is { businessDay: BusinessDay } {
  return typeof time === 'object' && time !== null && 'businessDay' in time;
}

function businessDayToUnixSeconds({ year, month, day }: BusinessDay): number {
  // BusinessDay has no time-of-day — anchor it at UTC midnight.
  return Date.UTC(year, month - 1, day) / 1000;
}

/**
 * Registered in the order they should be checked. To support a new source
 * format (e.g. a vendor that sends `{ ns: bigint }`), add a strategy here —
 * nothing else in the codebase needs to change.
 */
const strategies: TimeStrategy[] = [
  {
    name: 'unix-seconds',
    test: (time): time is number => typeof time === 'number',
    toUnixSeconds: (time) => time as number,
  },
  {
    name: 'unix-millis',
    test: isUnixMillis,
    toUnixSeconds: (time) => (time as UnixMillis).unixMs / 1000,
  },
  {
    name: 'business-day',
    test: isBusinessDay,
    toUnixSeconds: (time) => businessDayToUnixSeconds((time as { businessDay: BusinessDay }).businessDay),
  },
  {
    name: 'iso-string',
    test: (time): time is string => typeof time === 'string',
    toUnixSeconds: (time) => {
      const parsedMs = Date.parse(time as string);
      if (Number.isNaN(parsedMs)) {
        throw new Error(`cinder-charts: could not parse time string "${String(time)}" as ISO 8601`);
      }
      return parsedMs / 1000;
    },
  },
];

/**
 * Normalizes any supported `CinderTime` shape to unix seconds — the single
 * unit every downstream consumer (sorting, scaling, rendering) works in.
 */
export function toUnixSeconds(time: CinderTime): number {
  const strategy = strategies.find((s) => s.test(time));
  if (!strategy) {
    throw new Error(`cinder-charts: unrecognized time value ${JSON.stringify(time)}`);
  }
  const seconds = strategy.toUnixSeconds(time);
  if (!Number.isFinite(seconds)) {
    throw new Error(`cinder-charts: "${strategy.name}" strategy produced a non-finite time for ${JSON.stringify(time)}`);
  }
  return seconds;
}
