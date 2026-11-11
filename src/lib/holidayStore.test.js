import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { defaultHolidays, migrateLegacy, missingDefaults, loadHolidays, saveHolidays, STORAGE_KEY } from './holidayStore';
import { occurrencesForYear } from './holidayRules';
import { getHolidayMap, getHolidaysForYear, getDefaultHolidaysForYear } from '../holidays';

function fakeStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: (k) => { delete data[k]; },
    data,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('built-in holidays', () => {
  it('land where they always have in 2026', () => {
    const all = defaultHolidays();
    const first = Object.fromEntries(all.map((h) => [h.name, occurrencesForYear(h, 2026, all)[0]]));
    expect(first["Presidents' Day"].start).toBe('2026-02-16');
    expect(first['Memorial Day Weekend'].start).toBe('2026-05-22');
    expect(first['Memorial Day'].dates).toEqual(['2026-05-23', '2026-05-24', '2026-05-25']);
    expect(first['Labor Day'].dates).toEqual(['2026-09-05', '2026-09-06', '2026-09-07']);
    expect(first['Cow Harbor Day'].start).toBe('2026-09-19');
    expect(first['Columbus Day'].start).toBe('2026-10-12');
    expect(first['Thanksgiving Day'].start).toBe('2026-11-26');
    expect(first['Day after Thanksgiving'].start).toBe('2026-11-27');
  });

  // What the calendars drew before the list became editable (names aside).
  it('put the same days on the calendars as before', () => {
    const days = Object.keys(getHolidayMap([2027])).sort();
    expect(days).toEqual([
      '2027-01-01', '2027-01-18', '2027-03-17', '2027-05-09',
      '2027-05-29', '2027-05-30', '2027-05-31', '2027-06-20', '2027-07-04',
      '2027-09-04', '2027-09-05', '2027-09-06', '2027-09-18', '2027-09-19',
      '2027-10-31', '2027-11-25', '2027-11-26', '2027-12-24', '2027-12-25', '2027-12-31',
    ]);
    expect(getHolidayMap([2027])['2027-05-29']).toEqual(['Memorial Day']);
  });
});

describe('migrateLegacy', () => {
  const legacy = [
    { id: 'h-2026-thanksgiving', name: 'Turkey Day', date: '2026-11-26', timeOff: true, note: 'at Mom’s' },
    { id: 'h-2026-memorial', name: 'Memorial Day', date: '2026-05-25', timeOff: true },
    { id: 'h-2026-july4', name: 'Independence Day', date: '2026-07-03', timeOff: true },
    { id: 'h-1700000000000-42', name: 'Our anniversary', date: '2026-08-14', timeOff: false, note: '' },
    { id: 'h-1700000000001-7', name: 'No date', date: '' },
  ];
  const out = migrateLegacy(legacy);
  const get = (id) => out.find((h) => h.id === id);

  it('keeps names, notes and the day-off tick, and gives built-ins their real rule', () => {
    expect(get('h-2026-thanksgiving')).toMatchObject({ name: 'Turkey Day', note: 'at Mom’s', timeOff: true });
    expect(occurrencesForYear(get('h-2026-thanksgiving'), 2027)[0].start).toBe('2027-11-25');
    expect(get('h-2026-memorial').rule.durationDays).toBe(3);
  });
  it('turns hand-entered and hand-moved dates into that day every year', () => {
    expect(occurrencesForYear(get('h-1700000000000-42'), 2029)[0].start).toBe('2029-08-14');
    expect(get('h-1700000000000-42').calendar).toBe(true);
    expect(occurrencesForYear(get('h-2026-july4'), 2027)[0].start).toBe('2027-07-03');
  });
  it('keeps a dateless entry rather than dropping it', () => {
    expect(get('h-1700000000001-7').rule).toMatchObject({ kind: 'once', date: '' });
  });
  it('only backfills missing built-ins when asked', () => {
    expect(out).toHaveLength(legacy.length);
    expect(migrateLegacy(legacy, { backfill: true })).toHaveLength(legacy.length + missingDefaults(out).length);
  });
});

describe('storage', () => {
  let ls;
  beforeEach(() => { ls = fakeStorage(); vi.stubGlobal('localStorage', ls); });

  it('falls back to the built-ins when nothing is saved', () => {
    expect(loadHolidays().map((h) => h.id)).toEqual(defaultHolidays().map((h) => h.id));
    expect(ls.data[STORAGE_KEY]).toBeUndefined();
  });
  it('migrates the old list once, leaving it in place', () => {
    const old = JSON.stringify([{ id: 'h-9-9', name: 'Fest', date: '2026-04-02', timeOff: true }]);
    ls.setItem('rally.holidays.v1', old);
    ls.setItem('rally.holidays.seed.v3', '1');
    expect(loadHolidays().map((h) => h.name)).toEqual(['Fest']);
    expect(JSON.parse(ls.data[STORAGE_KEY])).toHaveLength(1);
    expect(ls.data['rally.holidays.v1']).toBe(old);
  });
  it('feeds saved holidays to the calendars, minus the ones unticked', () => {
    saveHolidays([
      { id: 'a', name: 'Payday', calendar: true, rule: { kind: 'interval', anchor: '2026-01-02', every: 2, unit: 'week' } },
      { id: 'b', name: 'Hidden', calendar: false, rule: { kind: 'date', months: [1], day: 2 } },
    ]);
    const map = getHolidayMap([2026]);
    expect(map['2026-01-02']).toEqual(['Payday']);
    expect(map['2026-01-16']).toEqual(['Payday']);
    expect(getHolidaysForYear(2026)).toHaveLength(26);
    // Features keyed to a named built-in are unaffected by the saved list.
    expect(getDefaultHolidaysForYear(2026).some((h) => h.name === "Mother's Day")).toBe(true);
  });
  it('survives corrupt storage', () => {
    ls.setItem(STORAGE_KEY, '{nope');
    expect(loadHolidays()).toHaveLength(defaultHolidays().length);
  });
});
