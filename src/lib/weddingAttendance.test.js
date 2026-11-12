import { describe, it, expect } from 'vitest';
import { expectedAttendance, normalizeDeclineRate } from './weddingAttendance';

const g = (status) => ({ status });

describe('expected attendance', () => {
  it('reads the rate, clamped, or null when unset', () => {
    expect(normalizeDeclineRate(undefined)).toBe(null);
    expect(normalizeDeclineRate('')).toBe(null);
    expect(normalizeDeclineRate('abc')).toBe(null);
    expect(normalizeDeclineRate(20)).toBe(20);
    expect(normalizeDeclineRate('15%')).toBe(15);
    expect(normalizeDeclineRate(-5)).toBe(0);
    expect(normalizeDeclineRate(140)).toBe(100);
    expect(normalizeDeclineRate(12.345)).toBe(12.3);
  });

  it('applies the rate to guests who have not answered', () => {
    const guests = [...Array(10)].map(() => g('Pending')).concat([g(''), g('Confirmed'), g('Confirmed'), g('Not coming')]);
    // 11 open, 2 confirmed, 1 declined. 20% of 11 = 2.2 → 9 of the open come.
    expect(expectedAttendance(guests, 20)).toEqual({
      total: 14, confirmed: 2, declined: 1, open: 11, rate: 20, notAttending: 3, expected: 11,
    });
  });

  it('with no rate, everyone not declined is expected', () => {
    expect(expectedAttendance([g('Pending'), g('Not coming'), g('Confirmed')], null))
      .toMatchObject({ expected: 2, notAttending: 1, rate: null });
    expect(expectedAttendance(undefined, 20)).toMatchObject({ total: 0, expected: 0 });
  });

  it('0% and 100% are the two ends', () => {
    const guests = [g('Pending'), g('Pending'), g('Confirmed')];
    expect(expectedAttendance(guests, 0).expected).toBe(3);
    expect(expectedAttendance(guests, 100).expected).toBe(1);
  });
});
