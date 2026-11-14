import { describe, it, expect } from 'vitest';
import { busyDays, suggestDates, cleanRanges, rangesSpan, defaultSuggestSetup, addDays, fromYmd } from './dateSuggest';

const fin = (id, title, y, m, d, extra = {}) => ({ id, title, stage: 'finalized', date: new Date(y, m - 1, d, 19, 0), ...extra });
const NOV = { from: '2026-11-01', to: '2026-11-30' };

describe('busyDays', () => {
  it('marks a settled event on its day', () => {
    const busy = busyDays([fin('a', 'Steak Night', 2026, 11, 20)], NOV);
    expect([...busy]).toEqual([['2026-11-20', ['Steak Night']]]);
  });

  it('marks every day of a multi-day trip, inside the range only', () => {
    const trip = fin('t', 'Ski Trip', 2026, 11, 28, { endDate: new Date(2026, 11, 2) });
    expect([...busyDays([trip], NOV).keys()]).toEqual(['2026-11-28', '2026-11-29', '2026-11-30']);
  });

  it('puts a yearly event on that year’s date, not the year it was made', () => {
    const halloween = fin('h', 'Halloween', 2024, 10, 31, {
      recurrence: { freq: 'yearly', mode: 'date', month: 10, day: 31, startYear: 2024, endYear: null },
    });
    const busy = busyDays([halloween], { from: '2027-10-01', to: '2027-11-15' });
    expect([...busy.keys()]).toEqual(['2027-10-31']);
  });

  it('leaves out what is not a commitment', () => {
    const events = [
      fin('self', 'This event', 2026, 11, 6),
      fin('x', 'Cancelled', 2026, 11, 7, { cancelled: true }),
      fin('v', 'Still voting', 2026, 11, 13, { stage: 'voting' }),
      fin('tbd', 'No date yet', 2026, 11, 14, { dateTBD: true }),
    ];
    expect(busyDays(events, { ...NOV, excludeId: 'self' }).size).toBe(0);
  });

  it('treats a far-off stale end date as a single day', () => {
    const stale = fin('s', 'Dinner', 2026, 11, 3, { endDate: new Date(2027, 5, 1) });
    expect([...busyDays([stale], NOV).keys()]).toEqual(['2026-11-03']);
  });

  it('names two events on the same day once each', () => {
    const busy = busyDays([fin('a', 'Lunch', 2026, 11, 20), fin('b', 'Dinner', 2026, 11, 20), fin('c', 'Dinner', 2026, 11, 20)], NOV);
    expect(busy.get('2026-11-20')).toEqual(['Lunch', 'Dinner']);
  });
});

describe('suggestDates', () => {
  it('offers the wanted weekdays in the range', () => {
    const { dates } = suggestDates({ ranges: [NOV], weekdays: [5, 6] });
    // Fridays and Saturdays of November 2026.
    expect(dates).toEqual(['2026-11-06', '2026-11-07', '2026-11-13', '2026-11-14', '2026-11-20', '2026-11-21', '2026-11-27', '2026-11-28']);
    dates.forEach((d) => expect([5, 6]).toContain(fromYmd(d).getDay()));
  });

  it('passes over busy days and says why', () => {
    const busy = busyDays([fin('a', 'Steak Night', 2026, 11, 20)], NOV);
    const r = suggestDates({ ranges: [NOV], weekdays: [5], busy });
    expect(r.dates).toEqual(['2026-11-06', '2026-11-13', '2026-11-27']);
    expect(r.busy).toEqual([{ date: '2026-11-20', titles: ['Steak Night'] }]);
  });

  it('does not report a busy day nobody wanted anyway', () => {
    const busy = busyDays([fin('a', 'Steak Night', 2026, 11, 18)], NOV); // a Wednesday
    expect(suggestDates({ ranges: [NOV], weekdays: [5], busy }).busy).toEqual([]);
  });

  it('leaves out days already on the poll and days gone by', () => {
    const r = suggestDates({ ranges: [NOV], weekdays: [5], taken: ['2026-11-13'], today: '2026-11-10' });
    expect(r.dates).toEqual(['2026-11-20', '2026-11-27']);
    expect(r.taken).toEqual(['2026-11-13']);
  });

  it('covers several ranges, in order, counting an overlap once', () => {
    const r = suggestDates({
      ranges: [{ from: '2026-12-01', to: '2026-12-12' }, { from: '2026-11-20', to: '2026-12-05' }],
      weekdays: [6],
    });
    expect(r.dates).toEqual(['2026-11-21', '2026-11-28', '2026-12-05', '2026-12-12']);
  });

  it('offers nothing with no weekday ticked or no usable range', () => {
    expect(suggestDates({ ranges: [NOV], weekdays: [] }).dates).toEqual([]);
    expect(suggestDates({ ranges: [{ from: '2026-11-30', to: '2026-11-01' }], weekdays: [5] }).dates).toEqual([]);
  });

  it('stops at the cap and says so', () => {
    const r = suggestDates({ ranges: [{ from: '2026-11-01', to: '2026-12-31' }], weekdays: [0, 1, 2, 3, 4, 5, 6], max: 10 });
    expect(r.dates).toHaveLength(10);
    expect(r.dates[0]).toBe('2026-11-01');
    expect(r.truncated).toBe(true);
  });
});

describe('ranges', () => {
  it('drops ranges that are backwards, half-filled or years long', () => {
    expect(cleanRanges([NOV, { from: '2026-11-10', to: '' }, { from: '2026-02-30', to: '2026-03-01' }, { from: '2026-01-01', to: '2029-01-01' }]))
      .toEqual([NOV]);
  });

  it('spans the earliest start to the latest end', () => {
    expect(rangesSpan([{ from: '2026-12-01', to: '2026-12-12' }, NOV])).toEqual({ from: '2026-11-01', to: '2026-12-12' });
    expect(rangesSpan([])).toBeNull();
  });

  it('steps a day across a month end', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
  });
});

describe('where the panel starts', () => {
  const today = '2026-11-14';

  it('uses the round’s poll window and the weekdays already on the poll', () => {
    const setup = defaultSuggestSetup({
      window: { from: '2026-11-21', to: '2026-12-20' },
      options: [{ startDate: '2026-11-27' }, { startDate: '2026-11-26' }, { startDate: '2026-11-25', closed: true }],
      today,
    });
    expect(setup).toEqual({ ranges: [{ from: '2026-11-21', to: '2026-12-20' }], weekdays: [4, 5] });
  });

  it('starts a window already under way from today', () => {
    const setup = defaultSuggestSetup({ window: { from: '2026-11-01', to: '2026-11-30' }, options: [], today });
    expect(setup.ranges).toEqual([{ from: today, to: '2026-11-30' }]);
  });

  it('falls back to the next six weeks and Friday–Saturday', () => {
    const setup = defaultSuggestSetup({ window: { from: '2026-09-01', to: '2026-09-30' }, options: [], today });
    expect(setup).toEqual({ ranges: [{ from: '2026-11-21', to: '2027-01-01' }], weekdays: [5, 6] });
    expect(defaultSuggestSetup({ window: null, options: null, today }).ranges).toEqual([{ from: '2026-11-21', to: '2027-01-01' }]);
  });
});
