import { describe, it, expect } from 'vitest';
import { normalizeAnnualDate, formatAnnualDate, annualDateInfo } from './looseDate';

// A fixed "today" so the day-counting below doesn't drift with the clock.
const TODAY = new Date(2026, 5, 2); // 2026-06-02

describe('normalizeAnnualDate', () => {
  it('keeps the year when one was given', () => {
    expect(normalizeAnnualDate('6/2/2015')).toBe('2015-06-02');
    expect(normalizeAnnualDate('June 2, 2015')).toBe('2015-06-02');
  });

  it('stores month/day alone when no year was given', () => {
    expect(normalizeAnnualDate('6/2')).toBe('06-02');
    expect(normalizeAnnualDate('Jun 2')).toBe('06-02');
  });

  it('round-trips its own stored forms', () => {
    expect(normalizeAnnualDate('2015-06-02')).toBe('2015-06-02');
    expect(normalizeAnnualDate('06-02')).toBe('06-02');
  });

  it('drops anything it cannot read rather than storing half a date', () => {
    expect(normalizeAnnualDate('sometime in June')).toBe('');
    expect(normalizeAnnualDate('')).toBe('');
    expect(normalizeAnnualDate(null)).toBe('');
  });
});

describe('formatAnnualDate', () => {
  it('shows the year only when there is one', () => {
    expect(formatAnnualDate('2015-06-02')).toBe('6/2/2015');
    expect(formatAnnualDate('06-02')).toBe('6/2');
  });

  it('is blank for a non-date', () => {
    expect(formatAnnualDate('whenever')).toBe('');
  });
});

describe('annualDateInfo', () => {
  it('flags the day itself and counts the anniversary being marked', () => {
    const info = annualDateInfo('2015-06-02', TODAY);
    expect(info.isToday).toBe(true);
    expect(info.daysUntil).toBe(0);
    expect(info.years).toBe(11);
  });

  it('counts forward to a date still to come this year', () => {
    const info = annualDateInfo('2015-06-16', TODAY);
    expect(info.isToday).toBe(false);
    expect(info.daysUntil).toBe(14);
    expect(info.years).toBe(11);
  });

  it('rolls past dates over to next year, and the count with them', () => {
    const info = annualDateInfo('2015-06-01', TODAY);
    expect(info.daysUntil).toBe(364); // 2027 is not a leap year
    expect(info.years).toBe(12);
  });

  it('works without a start year — the date recurs, the count just is not there', () => {
    const info = annualDateInfo('06-02', TODAY);
    expect(info.isToday).toBe(true);
    expect(info.years).toBe(null);
  });

  it('is null for anything that is not a date', () => {
    expect(annualDateInfo('', TODAY)).toBe(null);
    expect(annualDateInfo('next spring', TODAY)).toBe(null);
  });
});
