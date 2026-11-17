import { describe, it, expect } from 'vitest';
import { matchesColumnFilter, applyColumnFilters, activeColumnFilters } from './columnFilters';

describe('matchesColumnFilter', () => {
  it('matches every word, any order, any case', () => {
    expect(matchesColumnFilter('Jo Smith', 'smith jo')).toBe(true);
    expect(matchesColumnFilter('Jo Smith', 'smith al')).toBe(false);
    expect(matchesColumnFilter('anything', '   ')).toBe(true);
    expect(matchesColumnFilter('', 'x')).toBe(false);
  });
  it('compares phone digits on their own', () => {
    expect(matchesColumnFilter('(555) 123-4567', '555123', { digits: true })).toBe(true);
    expect(matchesColumnFilter('(555) 123-4567', '555-123', { digits: true })).toBe(true);
    expect(matchesColumnFilter('(555) 123-4567', '999', { digits: true })).toBe(false);
    // Letters in a phone box fall back to plain text.
    expect(matchesColumnFilter('ext 12', 'ext', { digits: true })).toBe(true);
  });
});

describe('applyColumnFilters', () => {
  const rows = [
    { name: 'Jo Smith', phone: '555-123-4567', group: 'Family' },
    { name: 'Al Jones', phone: '(555) 999-0000', group: 'College, Work' },
    { name: 'Sam Smith', phone: '', group: 'Work' },
  ];
  const textOf = (r, k) => r[k];
  it('keeps rows every filled box matches', () => {
    expect(applyColumnFilters(rows, { name: 'smith' }, textOf).map((r) => r.name)).toEqual(['Jo Smith', 'Sam Smith']);
    expect(applyColumnFilters(rows, { name: 'smith', group: 'work' }, textOf).map((r) => r.name)).toEqual(['Sam Smith']);
    expect(applyColumnFilters(rows, { phone: '555999' }, textOf, ['phone']).map((r) => r.name)).toEqual(['Al Jones']);
  });
  it('ignores empty boxes', () => {
    expect(applyColumnFilters(rows, { name: '', group: '  ' }, textOf)).toBe(rows);
    expect(activeColumnFilters({ name: '', group: 'x' })).toEqual([['group', 'x']]);
  });
});

describe('picking values', async () => {
  const { applyColumnPicks, columnValues, togglePick, activePicks } = await import('./columnFilters');
  const rows = [
    { status: 'Toured', area: 'nyc' },
    { status: 'Quote received', area: 'li' },
    { status: 'Researching', area: '' },
    { status: 'Toured', area: 'li' },
  ];
  const valueOf = (r, k) => r[k];

  it('keeps rows whose value is one of those ticked, in every ticked column', () => {
    expect(applyColumnPicks(rows, { status: ['Toured', 'Quote received'] }, valueOf)).toEqual([rows[0], rows[1], rows[3]]);
    expect(applyColumnPicks(rows, { status: ['Toured', 'Quote received'], area: ['li'] }, valueOf)).toEqual([rows[1], rows[3]]);
    expect(applyColumnPicks(rows, { area: [''] }, valueOf)).toEqual([rows[2]]);
    expect(applyColumnPicks(rows, { status: [] }, valueOf)).toBe(rows);
    expect(applyColumnPicks(rows, {}, valueOf)).toBe(rows);
  });

  it('lists a column’s values with counts, blanks first, numbers in order', () => {
    expect(columnValues(rows, 'status', valueOf)).toEqual([
      { value: 'Quote received', count: 1 }, { value: 'Researching', count: 1 }, { value: 'Toured', count: 2 },
    ]);
    expect(columnValues(rows, 'area', valueOf)[0]).toEqual({ value: '', count: 1 });
    expect(columnValues([{ c: '150' }, { c: '20' }, { c: ' 20 ' }], 'c', valueOf)).toEqual([{ value: '20', count: 2 }, { value: '150', count: 1 }]);
  });

  it('ticks and unticks one value, dropping a column left with none', () => {
    let p = togglePick({}, 'status', 'Toured');
    p = togglePick(p, 'status', 'Booked');
    expect(p).toEqual({ status: ['Toured', 'Booked'] });
    p = togglePick(p, 'status', 'Toured');
    expect(p).toEqual({ status: ['Booked'] });
    expect(togglePick(p, 'status', 'Booked')).toEqual({});
    expect(activePicks({ a: [], b: ['x'], c: null })).toEqual([['b', ['x']]]);
  });
});
