import { describe, it, expect } from 'vitest';
import { parseTypedDate, formatDateValue, isRealDate, isoToDate, withinBounds } from './dateInput';

const TODAY = new Date(2026, 8, 3); // 2026-09-03

describe('parseTypedDate', () => {
  it('reads the ISO form the fields already store', () => {
    expect(parseTypedDate('2026-09-12', TODAY)).toBe('2026-09-12');
  });

  it('reads slashed and dashed US dates', () => {
    expect(parseTypedDate('9/12/2026', TODAY)).toBe('2026-09-12');
    expect(parseTypedDate('09/12/2026', TODAY)).toBe('2026-09-12');
    expect(parseTypedDate('9-12-2026', TODAY)).toBe('2026-09-12');
  });

  it('expands two-digit years the way the import path does', () => {
    expect(parseTypedDate('9/12/26', TODAY)).toBe('2026-09-12');
    expect(parseTypedDate('7/30/85', TODAY)).toBe('1985-07-30');
  });

  it('defaults a bare month/day to the current year', () => {
    expect(parseTypedDate('9/12', TODAY)).toBe('2026-09-12');
    expect(parseTypedDate('Sep 12', TODAY)).toBe('2026-09-12');
  });

  it('reads month names', () => {
    expect(parseTypedDate('September 12, 2026', TODAY)).toBe('2026-09-12');
    expect(parseTypedDate('sept 12 2026', TODAY)).toBe('2026-09-12');
    expect(parseTypedDate('Dec 1st, 2026', TODAY)).toBe('2026-12-01');
  });

  it('reads the relative words people type', () => {
    expect(parseTypedDate('today', TODAY)).toBe('2026-09-03');
    expect(parseTypedDate('Tomorrow', TODAY)).toBe('2026-09-04');
    expect(parseTypedDate('yesterday', TODAY)).toBe('2026-09-02');
  });

  it('crosses month and year boundaries on the relative words', () => {
    expect(parseTypedDate('tomorrow', new Date(2026, 11, 31))).toBe('2027-01-01');
    expect(parseTypedDate('yesterday', new Date(2026, 0, 1))).toBe('2025-12-31');
  });

  it('rejects days that do not exist rather than rolling them forward', () => {
    expect(parseTypedDate('2/30/2026', TODAY)).toBe(null);
    expect(parseTypedDate('13/1/2026', TODAY)).toBe(null);
    expect(parseTypedDate('2/29/2026', TODAY)).toBe(null);
  });

  it('accepts a real leap day', () => {
    expect(parseTypedDate('2/29/2028', TODAY)).toBe('2028-02-29');
  });

  it('returns null for empty or unparseable text', () => {
    expect(parseTypedDate('', TODAY)).toBe(null);
    expect(parseTypedDate('   ', TODAY)).toBe(null);
    expect(parseTypedDate('next tuesday', TODAY)).toBe(null);
    expect(parseTypedDate('9/', TODAY)).toBe(null);
    expect(parseTypedDate(null, TODAY)).toBe(null);
  });
});

describe('isRealDate', () => {
  it('separates real days from overflow', () => {
    expect(isRealDate(2026, 9, 12)).toBe(true);
    expect(isRealDate(2026, 2, 30)).toBe(false);
  });
});

describe('formatDateValue', () => {
  it('shows the stored value the way the field reads it back', () => {
    expect(formatDateValue('2026-09-12')).toBe('09/12/2026');
  });

  it('renders nothing for an empty or half-written value', () => {
    expect(formatDateValue('')).toBe('');
    expect(formatDateValue('2026-09')).toBe('');
    expect(formatDateValue(undefined)).toBe('');
  });
});

describe('isoToDate', () => {
  it('lands on local midnight, not a UTC shift', () => {
    const d = isoToDate('2026-09-12');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(8);
    expect(d.getDate()).toBe(12);
  });

  it('returns null when there is no date', () => {
    expect(isoToDate('')).toBe(null);
  });
});

describe('withinBounds', () => {
  it('honours min and max when given', () => {
    expect(withinBounds('2026-09-12', '2026-09-01', '2026-09-30')).toBe(true);
    expect(withinBounds('2026-08-31', '2026-09-01', undefined)).toBe(false);
    expect(withinBounds('2026-10-01', undefined, '2026-09-30')).toBe(false);
  });

  it('is unbounded when neither is given', () => {
    expect(withinBounds('1999-01-01')).toBe(true);
  });
});
