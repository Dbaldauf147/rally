import { describe, it, expect } from 'vitest';
import { parentHolidayOn, parentsFor } from './parentHolidays';

describe('parentHolidayOn', () => {
  it("finds Mother's Day (2nd Sunday of May) and Father's Day (3rd Sunday of June)", () => {
    expect(parentHolidayOn(new Date(2027, 4, 9))?.key).toBe('mom');
    expect(parentHolidayOn(new Date(2027, 5, 20))?.key).toBe('dad');
    expect(parentHolidayOn(new Date(2026, 4, 10))?.key).toBe('mom');
  });
  it('is null on any other day', () => {
    expect(parentHolidayOn(new Date(2027, 4, 2))).toBeNull();
    expect(parentHolidayOn(new Date(2027, 6, 4))).toBeNull();
    expect(parentHolidayOn(null)).toBeNull();
  });
});

describe('parentsFor', () => {
  const friends = [
    { id: 'b', name: 'Beth', isMom: true },
    { id: 'a', name: 'Ann', isMom: true, isDad: false },
    { id: 'c', name: 'Carl', isDad: true },
    { id: 'd', name: 'Dee', isMom: 'yes' },
  ];
  it('returns only friends with that box ticked, sorted by name', () => {
    expect(parentsFor(friends, { field: 'isMom' }).map((f) => f.id)).toEqual(['a', 'b']);
    expect(parentsFor(friends, { field: 'isDad' }).map((f) => f.id)).toEqual(['c']);
    expect(parentsFor(friends, null)).toEqual([]);
  });
});
