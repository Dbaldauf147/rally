import { describe, it, expect } from 'vitest';
import {
  holidayTagsOf, holidayListFrom, holidayListForSync, holidaysStartingOn,
  holidayReachOutsOn, holidayReachOutMessage, namesText,
} from './holidayReachOut';
import { defaultHolidays } from './holidayStore';

const list = defaultHolidays();

describe('holidayTagsOf', () => {
  it('keeps unique non-empty string ids', () => {
    expect(holidayTagsOf({ holidayTags: ['a', '', 'a', 3, 'b'] })).toEqual(['a', 'b']);
    expect(holidayTagsOf({})).toEqual([]);
    expect(holidayTagsOf(null)).toEqual([]);
  });
});

describe('holidayListFrom', () => {
  it('falls back to the built-ins when nothing was mirrored', () => {
    expect(holidayListFrom(undefined).map((h) => h.id)).toEqual(list.map((h) => h.id));
    expect(holidayListFrom([]).length).toBe(list.length);
  });
  it('reads a mirrored copy, including custom holidays', () => {
    const custom = [{ id: 'h-x', name: 'Diwali', rule: { kind: 'once', date: '2026-11-08' } }];
    const got = holidayListFrom(holidayListForSync(custom));
    expect(got).toHaveLength(1);
    expect(holidaysStartingOn(got, '2026-11-08').map((h) => h.name)).toEqual(['Diwali']);
  });
});

describe('holidaysStartingOn', () => {
  it('finds a one-day holiday on its date', () => {
    expect(holidaysStartingOn(list, '2026-10-31').map((h) => h.id)).toEqual(['h-halloween']);
    expect(holidaysStartingOn(list, '2026-10-30')).toEqual([]);
  });
  it('counts a span once, on its first day', () => {
    // Memorial Day 2026 is Mon May 25, drawn Sat 23 – Mon 25.
    expect(holidaysStartingOn(list, '2026-05-23').map((h) => h.id)).toContain('h-2026-memorial');
    expect(holidaysStartingOn(list, '2026-05-25').map((h) => h.id)).not.toContain('h-2026-memorial');
  });
  it('includes holidays not shown on the calendars', () => {
    expect(holidaysStartingOn(list, '2026-11-11').map((h) => h.id)).toEqual(['h-2026-veterans']);
  });
});

describe('holidayReachOutsOn', () => {
  const friends = [
    { id: '2', name: 'Bo', holidayTags: ['h-halloween'] },
    { id: '1', name: 'Ann', holidayTags: ['h-2026-christmas', 'h-halloween'] },
    { id: '3', name: 'Cy', holidayTags: ['h-2026-christmas'] },
    { id: '4', name: 'Di' },
  ];
  it('groups tagged friends under the holiday starting today, by name', () => {
    const groups = holidayReachOutsOn(friends, list, '2026-10-31');
    expect(groups).toHaveLength(1);
    expect(groups[0].holiday.name).toBe('Halloween');
    expect(groups[0].friends.map((f) => f.name)).toEqual(['Ann', 'Bo']);
  });
  it('is empty when no one is tagged with today', () => {
    expect(holidayReachOutsOn(friends, list, '2026-07-04')).toEqual([]);
    expect(holidayReachOutsOn(friends, list, '2026-03-02')).toEqual([]);
  });
});

describe('holidayReachOutMessage', () => {
  it('names the one person', () => {
    const msg = holidayReachOutMessage([{ holiday: { name: 'Halloween' }, friends: [{ name: 'Ann' }] }]);
    expect(msg).toEqual({ title: 'Halloween: reach out to Ann', body: 'Halloween — Ann' });
  });
  it('counts several, across holidays', () => {
    const msg = holidayReachOutMessage([
      { holiday: { name: 'A' }, friends: [{ name: 'X' }, { name: 'Y' }] },
      { holiday: { name: 'B' }, friends: [{ name: 'Z' }] },
    ]);
    expect(msg.title).toBe('Holiday reach-outs: 3 people');
    expect(msg.body).toBe('A — X and Y\nB — Z');
  });
  it('is null with nothing to say', () => {
    expect(holidayReachOutMessage([])).toBeNull();
  });
  it('shortens a long list of names', () => {
    expect(namesText(['A', 'B', 'C', 'D', 'E'])).toBe('A, B and 3 others');
    expect(namesText(['A', 'B', 'C'])).toBe('A, B and C');
  });
});
