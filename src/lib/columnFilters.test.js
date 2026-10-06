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
