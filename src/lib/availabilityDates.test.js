import { describe, it, expect } from 'vitest';
import { datesFromAvailability, summarizeDates } from './availabilityDates';

const YACHT = 'Saturdays in June 2027 open; September 18, 2027 on hold until Dec 1';
const CLIFF = 'No Saturdays left in 2027; Fridays and Sundays May to October 2027';

const weekday = (d) => new Date(`${d}T00:00:00Z`).getUTCDay();

describe('datesFromAvailability', () => {
  it('reads the yacht club row: June Saturdays and the held date, not the hold deadline', () => {
    expect(datesFromAvailability(YACHT)).toEqual(['2027-06-05', '2027-06-12', '2027-06-19', '2027-06-26', '2027-09-18']);
  });

  it('reads the sea cliff row: every Friday and Sunday May to October, and skips the "No Saturdays" clause', () => {
    const d = datesFromAvailability(CLIFF);
    expect(d[0]).toBe('2027-05-02');
    expect(d[d.length - 1]).toBe('2027-10-31');
    expect(d).toHaveLength(53);
    expect(d.every((x) => [0, 5].includes(weekday(x)))).toBe(true);
    expect(d.some((x) => weekday(x) === 6)).toBe(false);
  });

  it('reads dates written several ways', () => {
    expect(datesFromAvailability('Sept 18th 2027')).toEqual(['2027-09-18']);
    expect(datesFromAvailability('June 5, 12 and 19, 2027 are open')).toEqual(['2027-06-05', '2027-06-12', '2027-06-19']);
    expect(datesFromAvailability('9/18/2027 or 10/2/27')).toEqual(['2027-09-18', '2027-10-02']);
    expect(datesFromAvailability('Sat, Jun 12, 2027')).toEqual(['2027-06-12']);
    expect(datesFromAvailability('OCTOBER 9, 2027\nOctober 16, 2027')).toEqual(['2027-10-09', '2027-10-16']);
  });

  it('takes a day with no year from its clause’s one year', () => {
    expect(datesFromAvailability('2027: June 5 or June 12')).toEqual(['2027-06-05', '2027-06-12']);
  });

  it('reads weekdays over a month, a range, a list of months and a whole year', () => {
    expect(datesFromAvailability('Fridays in September 2027')).toEqual(['2027-09-03', '2027-09-10', '2027-09-17', '2027-09-24']);
    expect(datesFromAvailability('every Sunday in June and July 2027')).toHaveLength(8);
    expect(datesFromAvailability('Saturdays May–June 2027')).toHaveLength(9); // May 2027 has five
    expect(datesFromAvailability('Fridays in 2027')).toHaveLength(53);
  });

  it('guesses nothing', () => {
    expect(datesFromAvailability('Seasonal venue; September and early October 2027 only, Saturdays booked through June')).toEqual([]);
    expect(datesFromAvailability('June 12 open')).toEqual([]); // no year
    expect(datesFromAvailability('Saturdays in June')).toEqual([]); // no year
    expect(datesFromAvailability('June 12, 2026 or June 12, 2027 — Saturdays in June')).toEqual(['2026-06-12', '2027-06-12']); // two years: the pattern has none
    expect(datesFromAvailability('Booked: June 12, 2027')).toEqual([]);
    expect(datesFromAvailability('June 12, 2027 is unavailable')).toEqual([]);
    expect(datesFromAvailability('Call to ask')).toEqual([]);
    expect(datesFromAvailability('')).toEqual([]);
    expect(datesFromAvailability(null)).toEqual([]);
    expect(datesFromAvailability('February 30, 2027')).toEqual([]);
  });

  it('leaves out a deadline', () => {
    expect(datesFromAvailability('October 2, 2027 held until March 1, 2027')).toEqual(['2027-10-02']);
    expect(datesFromAvailability('Decide by 1/15/2027; 10/9/2027 open')).toEqual(['2027-10-09']);
  });
});

describe('summarizeDates', () => {
  it('lists a few, and sums up many', () => {
    expect(summarizeDates([])).toBe('');
    expect(summarizeDates(['2027-09-18'])).toBe('Sat, Sep 18, 2027');
    expect(summarizeDates(datesFromAvailability(CLIFF))).toBe('53 dates, Sun, May 2, 2027 – Sun, Oct 31, 2027');
  });
});
