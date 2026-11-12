import { describe, it, expect } from 'vitest';
import { normalizeVenue, normalizeDateList, formatAvailableDate, formatDateList } from './weddingVenues';
import { cellValue, withCellValue, parseDateList, sortVenueRows, autoMapVenueHeaders } from './venueTable';

describe('dates available', () => {
  it('keeps a sorted, de-duplicated list of real ISO dates', () => {
    expect(normalizeDateList(['2027-06-19', '2027-06-12', '2027-06-12', 'junk', '2027-02-30x', 7])).toEqual(['2027-06-12', '2027-06-19']);
    expect(normalizeDateList(undefined)).toEqual([]);
    expect(normalizeVenue({ name: 'A' }).availableDates).toEqual([]);
    expect(normalizeVenue({ name: 'A', availableDates: ['2027-06-19', '2027-06-12'] }).availableDates).toEqual(['2027-06-12', '2027-06-19']);
  });

  it('shows each date with its weekday', () => {
    expect(formatAvailableDate('2027-06-12')).toBe('Sat, Jun 12, 2027');
    expect(formatDateList(['2027-06-19', '2027-06-12'])).toBe('Sat, Jun 12, 2027; Sat, Jun 19, 2027');
  });

  it('reads dates typed or pasted in several shapes', () => {
    expect(parseDateList('6/12/2027, 6/19/2027')).toEqual(['2027-06-12', '2027-06-19']);
    expect(parseDateList('Sat, Jun 12, 2027; Sat, Jun 19, 2027')).toEqual(['2027-06-12', '2027-06-19']);
    expect(parseDateList('2027-06-12\nSaturday June 26, 2027')).toEqual(['2027-06-12', '2027-06-26']);
    expect(parseDateList('sometime in June; 6/12/27')).toEqual(['2027-06-12']);
    expect(parseDateList('')).toEqual([]);
  });

  it('round-trips through a table cell, and a blank clears it', () => {
    let v = normalizeVenue({ name: 'Harbor Club' });
    v = withCellValue(v, 'availableDates', '6/19/2027; 6/12/2027');
    expect(v.availableDates).toEqual(['2027-06-12', '2027-06-19']);
    expect(cellValue(v, 'availableDates')).toBe('Sat, Jun 12, 2027; Sat, Jun 19, 2027');
    // What the cell shows reads back to the same dates.
    expect(withCellValue(v, 'availableDates', cellValue(v, 'availableDates')).availableDates).toEqual(v.availableDates);
    expect(withCellValue(v, 'availableDates', '').availableDates).toEqual([]);
  });

  it('sorts by the first open date, venues with none last', () => {
    const list = [
      normalizeVenue({ id: 'a', name: 'A', availableDates: ['2027-09-04'] }),
      normalizeVenue({ id: 'b', name: 'B' }),
      normalizeVenue({ id: 'c', name: 'C', availableDates: ['2027-06-12', '2027-10-01'] }),
    ];
    expect(sortVenueRows(list, { key: 'availableDates', dir: 'asc' }).map((v) => v.id)).toEqual(['c', 'a', 'b']);
    expect(sortVenueRows(list, { key: 'availableDates', dir: 'desc' }).map((v) => v.id)).toEqual(['a', 'c', 'b']);
  });

  it('maps the exact "Dates available" header to the dates; looser ones stay free text', () => {
    const m = autoMapVenueHeaders(['Venue', 'Dates available', 'Availability']);
    expect(m).toEqual(['name', 'availableDates', 'availability']);
    expect(autoMapVenueHeaders(['Venue', 'Available dates'])).toEqual(['name', 'availability']);
  });
});
