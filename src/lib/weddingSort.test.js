import { describe, it, expect } from 'vitest';
import { makeGuestComparator, sameSortValue, statusOrder } from './weddingSort';

const g = (id, firstName, lastName, extra = {}) => ({ id, firstName, lastName, ...extra });
const ids = (rows) => rows.map((r) => r.id);

describe('makeGuestComparator', () => {
  const rows = [
    g('a', 'Ann', 'smith', { city: 'Boston', status: 'Confirmed' }),
    g('b', 'Bob', 'Adams', { city: '' }),
    g('c', 'Cat', 'Jones', { city: 'austin' }),
    g('d', 'Dan', 'Young', { city: 'Boston', status: 'Not coming' }),
    g('e', 'Eve', 'Brown', { city: 'Chicago', status: 'Pending' }),
  ];
  const city = (c) => c.city;

  it('sorts by the column alone, case-insensitively, blanks last, ties by name', () => {
    expect(ids([...rows].sort(makeGuestComparator({ value: city })))).toEqual(['c', 'a', 'd', 'e', 'b']);
  });
  it('descending flips the values but keeps blanks last and ties A→Z', () => {
    expect(ids([...rows].sort(makeGuestComparator({ value: city, dir: 'desc' })))).toEqual(['e', 'a', 'd', 'c', 'b']);
  });
  it('the default view sinks Confirmed, then Not coming, below everyone else', () => {
    const byName = (c) => [c.lastName, c.firstName];
    expect(ids([...rows].sort(makeGuestComparator({ value: byName, sinkStatus: true })))).toEqual(['b', 'e', 'c', 'a', 'd']);
  });
  it('numbers inside text sort in order', () => {
    const t = [g('x', 'X', 'X', { t: 'Table 10' }), g('y', 'Y', 'Y', { t: 'Table 2' })];
    expect(ids(t.sort(makeGuestComparator({ value: (c) => c.t })))).toEqual(['y', 'x']);
  });
  it('a list value compares part by part (subcategory inside category)', () => {
    const t = [
      g('x', 'X', 'X', { v: ['Friends', 'Alpha'] }),
      g('y', 'Y', 'Y', { v: ['Family', 'Zed'] }),
      g('z', 'Z', 'Z', { v: '' }),
    ];
    expect(ids(t.sort(makeGuestComparator({ value: (c) => c.v })))).toEqual(['y', 'x', 'z']);
  });
  it('the Status column puts Pending, then no status, Confirmed, Not coming', () => {
    expect(ids([...rows].sort(makeGuestComparator({ value: statusOrder })))).toEqual(['e', 'b', 'c', 'a', 'd']);
  });
});

describe('sameSortValue', () => {
  it('ignores case and spacing, and blanks only match blanks', () => {
    expect(sameSortValue('Boston ', 'boston')).toBe(true);
    expect(sameSortValue('', undefined)).toBe(true);
    expect(sameSortValue('', 'Boston')).toBe(false);
  });
});
