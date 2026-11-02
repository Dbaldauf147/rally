import { describe, it, expect } from 'vitest';
import {
  SEED_ITEMS, seedTimeline, normalizeTimeline, itemDate, daysUntil, relativeLabel,
  splitDays, joinDays, groupByMonth, nextItem, isOverdue, addItem, updateItem, removeItem,
  setDate, cleanDate,
} from './weddingTimeline.js';

describe('the draft', () => {
  it('has unique ids, a wedding day, and sorts furthest-out first', () => {
    const ids = SEED_ITEMS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    const t = seedTimeline();
    expect(t.items.some((i) => i.daysBefore === 0 && i.milestone)).toBe(true);
    const days = t.items.map((i) => i.daysBefore);
    expect(days).toEqual([...days].sort((a, b) => b - a));
    expect(t.items.every((i) => i.title && i.done === false)).toBe(true);
  });

  it('is what an account with nothing saved reads', () => {
    expect(normalizeTimeline(null).items).toHaveLength(SEED_ITEMS.length);
    expect(normalizeTimeline({ items: [] }).items).toHaveLength(0);
  });
});

describe('dates', () => {
  it('puts an item the right number of days before the wedding, across months and years', () => {
    expect(itemDate('2027-06-12', 0)).toBe('2027-06-12');
    expect(itemDate('2027-06-12', 56)).toBe('2027-04-17');
    expect(itemDate('2027-01-05', 10)).toBe('2026-12-26');
    expect(itemDate('2027-06-12', -14)).toBe('2027-06-26');
    expect(itemDate('', 10)).toBe('');
  });

  it('crosses daylight-saving changes without drifting a day', () => {
    expect(itemDate('2027-03-20', 14)).toBe('2027-03-06');
    expect(daysUntil('2027-03-20', '2027-03-06')).toBe(14);
  });

  it('rejects dates that are not real', () => {
    expect(cleanDate('2027-02-30')).toBe('');
    expect(cleanDate('June 12')).toBe('');
    expect(cleanDate(' 2027-06-12 ')).toBe('2027-06-12');
  });

  it('moves the whole plan when the wedding moves', () => {
    const t = setDate(seedTimeline('2027-06-12'), '2027-09-18');
    const venue = t.items.find((i) => i.id === 'venue');
    expect(itemDate(t.date, venue.daysBefore)).toBe(itemDate('2027-09-18', 345));
  });
});

describe('relativeLabel', () => {
  it('rounds the way people say it', () => {
    expect(relativeLabel(0)).toBe('Wedding day');
    expect(relativeLabel(1)).toBe('The day before');
    expect(relativeLabel(-1)).toBe('The day after');
    expect(relativeLabel(4)).toBe('4 days before');
    expect(relativeLabel(56)).toBe('8 weeks before');
    expect(relativeLabel(345)).toBe('11 months before');
    expect(relativeLabel(-90)).toBe('3 months after');
  });
});

describe('the when editor', () => {
  it('round-trips amount / unit / side', () => {
    for (const d of [0, 1, 4, 14, 45, 56, 90, 345, -14, -30, -90]) {
      expect(joinDays(splitDays(d))).toBe(d);
    }
    expect(splitDays(56)).toEqual({ amount: 8, unit: 'weeks', side: 'before' });
    expect(splitDays(-90)).toEqual({ amount: 3, unit: 'months', side: 'after' });
    expect(joinDays({ amount: '2', unit: 'months', side: 'before' })).toBe(60);
    expect(joinDays({ amount: -5, unit: 'days', side: 'before' })).toBe(0);
  });
});

describe('grouping and progress', () => {
  const t = normalizeTimeline({
    date: '2027-06-12',
    items: [
      { id: 'a', daysBefore: 100, title: 'A', done: true },
      { id: 'b', daysBefore: 95, title: 'B' },
      { id: 'c', daysBefore: 10, title: 'C' },
      { id: 'd', daysBefore: 0, title: 'D' },
    ],
  });

  it('groups by calendar month in order', () => {
    const g = groupByMonth(t);
    expect(g.map((x) => x.label)).toEqual(['March 2027', 'June 2027']);
    expect(g[0].items.map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('is one unlabelled group with no date', () => {
    const g = groupByMonth({ ...t, date: '' });
    expect(g).toHaveLength(1);
    expect(g[0].label).toBe('');
  });

  it('knows what is next and what is late', () => {
    expect(nextItem(t).id).toBe('b');
    const b = t.items.find((i) => i.id === 'b');
    expect(isOverdue(t, b, '2027-04-01')).toBe(true);
    expect(isOverdue(t, b, '2027-03-09')).toBe(false);
    expect(isOverdue(t, t.items[0], '2027-06-01')).toBe(false); // done is never late
    expect(isOverdue({ ...t, date: '' }, b, '2027-06-01')).toBe(false);
  });
});

describe('editing', () => {
  it('adds, re-sorts on a timing change, and removes', () => {
    let t = normalizeTimeline({ date: '', items: [{ id: 'x', daysBefore: 50, title: 'X' }] });
    t = addItem(t, { title: 'New', daysBefore: 100 });
    expect(t.items.map((i) => i.title)).toEqual(['New', 'X']);
    const newId = t.items[0].id;
    t = updateItem(t, newId, { daysBefore: 5 });
    expect(t.items.map((i) => i.title)).toEqual(['X', 'New']);
    t = removeItem(t, 'x');
    expect(t.items.map((i) => i.title)).toEqual(['New']);
  });

  it('keeps same-day items in their saved order', () => {
    const t = normalizeTimeline({ items: [{ id: 'p', daysBefore: 7, title: 'P' }, { id: 'q', daysBefore: 7, title: 'Q' }] });
    expect(t.items.map((i) => i.id)).toEqual(['p', 'q']);
  });

  it('repairs duplicate ids rather than losing an item', () => {
    const t = normalizeTimeline({ items: [{ id: 'z', daysBefore: 7, title: 'One' }, { id: 'z', daysBefore: 6, title: 'Two' }] });
    expect(t.items).toHaveLength(2);
    expect(new Set(t.items.map((i) => i.id)).size).toBe(2);
  });
});
