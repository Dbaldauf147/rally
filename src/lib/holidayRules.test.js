import { describe, it, expect } from 'vitest';
import {
  occurrencesForYear, occurrencesInRange, nextOccurrences, describeRule,
  normalizeRule, ruleProblem, easterSunday, toIso,
} from './holidayRules';

const h = (rule, id = 'x', name = 'X') => ({ id, name, rule });
const starts = (rule, year, all = []) => occurrencesForYear(h(rule), year, all).map((o) => o.start);

describe('date rules', () => {
  it('lands on the same date each year', () => {
    expect(starts({ kind: 'date', months: [7], day: 4 }, 2027)).toEqual(['2027-07-04']);
  });
  it('covers several months, or every month when none are picked', () => {
    expect(starts({ kind: 'date', months: [3, 9], day: 15 }, 2026)).toEqual(['2026-03-15', '2026-09-15']);
    expect(starts({ kind: 'date', months: [], day: 1 }, 2026)).toHaveLength(12);
  });
  it('skips months too short for the day, and handles "last day"', () => {
    expect(starts({ kind: 'date', months: [], day: 31 }, 2026)).toHaveLength(7);
    expect(starts({ kind: 'date', months: [2], day: 29 }, 2026)).toEqual([]);
    expect(starts({ kind: 'date', months: [2], day: 29 }, 2028)).toEqual(['2028-02-29']);
    expect(starts({ kind: 'date', months: [2], day: -1 }, 2026)).toEqual(['2026-02-28']);
    expect(starts({ kind: 'date', months: [2], day: -1 }, 2028)).toEqual(['2028-02-29']);
  });
});

describe('weekday rules', () => {
  it('finds the nth and the last weekday of a month', () => {
    expect(starts({ kind: 'weekday', months: [11], weekday: 4, nth: 4 }, 2026)).toEqual(['2026-11-26']);
    expect(starts({ kind: 'weekday', months: [5], weekday: 1, nth: -1 }, 2026)).toEqual(['2026-05-25']);
    expect(starts({ kind: 'weekday', months: [5], weekday: 1, nth: -1 }, 2027)).toEqual(['2027-05-31']);
  });
  it('has no fifth weekday in months that only have four', () => {
    // 2026 has a fifth Friday in Jan, May, Jul, Oct.
    expect(starts({ kind: 'weekday', months: [], weekday: 5, nth: 5 }, 2026))
      .toEqual(['2026-01-30', '2026-05-29', '2026-07-31', '2026-10-30']);
  });
});

describe('interval rules', () => {
  it('repeats every N weeks from the anchor, never before it', () => {
    const rule = { kind: 'interval', anchor: '2026-01-02', every: 2, unit: 'week' };
    const got = starts(rule, 2026);
    expect(got.slice(0, 3)).toEqual(['2026-01-02', '2026-01-16', '2026-01-30']);
    expect(got).toHaveLength(26);
    expect(starts(rule, 2025)).toEqual([]);
    // Stays on the same phase years later.
    expect(starts(rule, 2030)[0]).toBe('2030-01-11');
  });
  it('repeats every N days', () => {
    expect(starts({ kind: 'interval', anchor: '2026-01-01', every: 100, unit: 'day' }, 2026))
      .toEqual(['2026-01-01', '2026-04-11', '2026-07-20', '2026-10-28']);
  });
  it('repeats monthly and yearly, pinning the 31st to short months', () => {
    expect(starts({ kind: 'interval', anchor: '2026-01-31', every: 1, unit: 'month' }, 2026).slice(0, 4))
      .toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
    expect(starts({ kind: 'interval', anchor: '2024-06-10', every: 3, unit: 'month' }, 2026))
      .toEqual(['2026-03-10', '2026-06-10', '2026-09-10', '2026-12-10']);
    const fiveYearly = { kind: 'interval', anchor: '2020-08-15', every: 5, unit: 'year' };
    expect(starts(fiveYearly, 2025)).toEqual(['2025-08-15']);
    expect(starts(fiveYearly, 2026)).toEqual([]);
  });
});

describe('easter and relative rules', () => {
  it('computes Easter Sunday', () => {
    expect(toIso(easterSunday(2024))).toBe('2024-03-31');
    expect(toIso(easterSunday(2026))).toBe('2026-04-05');
    expect(toIso(easterSunday(2027))).toBe('2027-03-28');
  });
  it('offsets from Easter', () => {
    expect(starts({ kind: 'easter', offsetDays: -2 }, 2026)).toEqual(['2026-04-03']); // Good Friday
  });
  it('follows another holiday, including through a chain', () => {
    const thanksgiving = h({ kind: 'weekday', months: [11], weekday: 4, nth: 4 }, 'tg', 'Thanksgiving');
    const blackFriday = h({ kind: 'relative', baseId: 'tg', offsetDays: 1 }, 'bf', 'Black Friday');
    const cyberMonday = h({ kind: 'relative', baseId: 'bf', offsetDays: 3 }, 'cm', 'Cyber Monday');
    const all = [thanksgiving, blackFriday, cyberMonday];
    expect(occurrencesForYear(blackFriday, 2026, all).map((o) => o.start)).toEqual(['2026-11-27']);
    expect(occurrencesForYear(cyberMonday, 2026, all).map((o) => o.start)).toEqual(['2026-11-30']);
  });
  it('yields nothing for a missing base or a loop, rather than hanging', () => {
    const a = h({ kind: 'relative', baseId: 'b' }, 'a');
    const b = h({ kind: 'relative', baseId: 'a' }, 'b');
    expect(occurrencesForYear(a, 2026, [a, b])).toEqual([]);
    expect(occurrencesForYear(h({ kind: 'relative', baseId: 'gone' }), 2026, [])).toEqual([]);
    expect(ruleProblem({ kind: 'relative', baseId: 'b' }, [a, b], 'a')).toMatch(/depends on this one/);
    expect(ruleProblem({ kind: 'relative', baseId: 'gone' }, [a, b], 'a')).toMatch(/no longer exists/);
  });
});

describe('fine-tuning', () => {
  it('moves weekend dates', () => {
    const july4 = { kind: 'date', months: [7], day: 4 }; // Saturday in 2026, Sunday in 2027
    expect(starts({ ...july4, adjust: { type: 'nearestWeekday' } }, 2026)).toEqual(['2026-07-03']);
    expect(starts({ ...july4, adjust: { type: 'nearestWeekday' } }, 2027)).toEqual(['2027-07-05']);
    expect(starts({ ...july4, adjust: { type: 'nextMonday' } }, 2026)).toEqual(['2026-07-06']);
    expect(starts({ ...july4, adjust: { type: 'previousFriday' } }, 2027)).toEqual(['2027-07-02']);
    expect(starts({ ...july4, adjust: { type: 'nearestWeekday' } }, 2028)).toEqual(['2028-07-04']);
  });
  it('snaps to a weekday on/after, on/before, or nearest', () => {
    // US Election Day: the Tuesday after the first Monday of November.
    const nov2 = { kind: 'date', months: [11], day: 2 };
    expect(starts({ ...nov2, adjust: { type: 'weekdayOnOrAfter', weekday: 2 } }, 2026)).toEqual(['2026-11-03']);
    expect(starts({ ...nov2, adjust: { type: 'weekdayOnOrAfter', weekday: 2 } }, 2027)).toEqual(['2027-11-02']);
    // Victoria Day: the Monday on or before May 24.
    expect(starts({ kind: 'date', months: [5], day: 24, adjust: { type: 'weekdayOnOrBefore', weekday: 1 } }, 2026)).toEqual(['2026-05-18']);
    expect(starts({ kind: 'date', months: [6], day: 10, adjust: { type: 'weekdayNearest', weekday: 6 } }, 2026)).toEqual(['2026-06-13']);
    expect(starts({ kind: 'date', months: [6], day: 9, adjust: { type: 'weekdayNearest', weekday: 6 } }, 2026)).toEqual(['2026-06-06']);
  });
  it('shifts and stretches: a long weekend around a Monday', () => {
    const [occ] = occurrencesForYear(h({ kind: 'weekday', months: [5], weekday: 1, nth: -1, offsetDays: -2, durationDays: 3 }), 2026);
    expect(occ).toEqual({ start: '2026-05-23', end: '2026-05-25', dates: ['2026-05-23', '2026-05-24', '2026-05-25'] });
  });
  it('runs only every N years', () => {
    const election = { kind: 'date', months: [11], day: 2, adjust: { type: 'weekdayOnOrAfter', weekday: 2 }, everyYears: 4, anchorYear: 2024 };
    expect(starts(election, 2026)).toEqual([]);
    expect(starts(election, 2028)).toEqual(['2028-11-07']);
    expect(starts(election, 2020)).toEqual(['2020-11-03']);
  });
  it('respects start and end dates', () => {
    const rule = { kind: 'date', months: [], day: 15, startDate: '2026-03-01', endDate: '2026-06-30' };
    expect(starts(rule, 2026)).toEqual(['2026-03-15', '2026-04-15', '2026-05-15', '2026-06-15']);
    expect(ruleProblem({ ...rule, endDate: '2026-01-01' })).toMatch(/ends before/);
  });
});

describe('ranges', () => {
  const nye = h({ kind: 'date', months: [12], day: 31, durationDays: 2 });
  it('finds a span that reaches into the range from before it', () => {
    expect(occurrencesInRange(nye, '2027-01-01', '2027-01-31').map((o) => o.dates))
      .toEqual([['2026-12-31', '2027-01-01']]);
  });
  it('lists a span under the year it starts in', () => {
    expect(occurrencesForYear(nye, 2027).map((o) => o.start)).toEqual(['2027-12-31']);
  });
  it('returns nothing for a bad range', () => {
    expect(occurrencesInRange(nye, '2027-02-01', '2027-01-01')).toEqual([]);
    expect(occurrencesInRange(nye, 'nope', '2027-01-01')).toEqual([]);
  });
});

describe('nextOccurrences', () => {
  it('counts an occurrence that is still running, then moves on', () => {
    const rule = h({ kind: 'date', months: [12], day: 24, durationDays: 3 });
    expect(nextOccurrences(rule, '2026-12-25', 2).map((o) => o.start)).toEqual(['2026-12-24', '2027-12-24']);
    expect(nextOccurrences(rule, '2026-12-27', 1).map((o) => o.start)).toEqual(['2027-12-24']);
  });
  it('reaches across years for sparse cadences', () => {
    const leap = h({ kind: 'date', months: [2], day: 29 });
    expect(nextOccurrences(leap, '2026-11-11', 2).map((o) => o.start)).toEqual(['2028-02-29', '2032-02-29']);
  });
  it('is empty once a one-off has passed', () => {
    expect(nextOccurrences(h({ kind: 'once', date: '2025-01-01' }), '2026-01-01', 3)).toEqual([]);
    expect(nextOccurrences(h({ kind: 'once', date: '2027-05-05' }), '2026-01-01', 3).map((o) => o.start)).toEqual(['2027-05-05']);
  });
});

describe('normalizeRule', () => {
  it('repairs junk into a usable rule', () => {
    const r = normalizeRule({ kind: 'bogus', months: [0, 13, '5', 5], day: 99, durationDays: 0, offsetDays: 'x', every: -3 });
    expect(r).toMatchObject({ kind: 'date', months: [5], day: 31, durationDays: 1, offsetDays: 0, every: 1 });
    expect(normalizeRule(null).kind).toBe('date');
    expect(normalizeRule({ date: '2026-02-30' }).date).toBe('');
  });
});

describe('describeRule', () => {
  const all = [{ id: 'tg', name: 'Thanksgiving Day', rule: {} }];
  it.each([
    [{ kind: 'date', months: [7], day: 4 }, 'Every July 4'],
    [{ kind: 'date', months: [], day: 15 }, 'The 15th of every month'],
    [{ kind: 'date', months: [3, 9], day: -1 }, 'The last day of March and September'],
    [{ kind: 'weekday', months: [11], weekday: 4, nth: 4 }, 'The fourth Thursday of November'],
    [{ kind: 'weekday', months: [], weekday: 5, nth: 1 }, 'The first Friday of every month'],
    [{ kind: 'weekday', months: [5], weekday: 1, nth: -1, offsetDays: -2, durationDays: 3 }, 'The last Monday of May, 2 days earlier, for 3 days'],
    [{ kind: 'interval', anchor: '2026-01-02', every: 2, unit: 'week' }, 'Every 2 weeks from Jan 2, 2026'],
    [{ kind: 'easter', offsetDays: -2 }, '2 days before Easter Sunday'],
    [{ kind: 'relative', baseId: 'tg', offsetDays: 1 }, '1 day after Thanksgiving Day'],
    [{ kind: 'relative', baseId: 'tg' }, 'Same day as Thanksgiving Day'],
    [{ kind: 'once', date: '2027-05-05' }, 'Once, on May 5, 2027'],
    [{ kind: 'date', months: [7], day: 4, adjust: { type: 'nearestWeekday' } }, 'Every July 4, moved to the nearest weekday if it lands on a weekend'],
    [{ kind: 'date', months: [11], day: 2, adjust: { type: 'weekdayOnOrAfter', weekday: 2 }, everyYears: 4, anchorYear: 2024 },
      'Every November 2, moved to the Tuesday on or after, every 4 years (2024, 2028…)'],
    [{ kind: 'date', months: [1], day: 1, endDate: '2030-12-31' }, 'Every January 1, until Dec 31, 2030'],
  ])('%j → %s', (rule, text) => {
    expect(describeRule(rule, all)).toBe(text);
  });
});
