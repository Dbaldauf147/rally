import { describe, it, expect } from 'vitest';
import { normalizeRecurrence, occurrenceForYear, nextOccurrence, describeRecurrence } from './recurrence';

const date = new Date(2026, 10, 28); // Nov 28 2026, local
const now = new Date(2026, 10, 14, 12);
const event = (recurrence) => ({ date, allDay: true, recurrence });

describe('normalizeRecurrence: unset years', () => {
  it('reads a missing, null or blank year as not set — never as year 0', () => {
    for (const blank of [undefined, null, '']) {
      const rule = normalizeRecurrence({ freq: 'yearly', mode: 'date', month: 11, day: 28, startYear: blank, endYear: blank });
      expect(rule).toMatchObject({ startYear: null, endYear: null });
    }
  });
  it('gives the same rule when normalized twice', () => {
    const once = normalizeRecurrence({ freq: 'yearly', mode: 'date', month: 11, day: 28 });
    expect(normalizeRecurrence(once)).toEqual(once);
    const weekday = normalizeRecurrence({ freq: 'yearly', mode: 'weekday', month: 9, week: 3, weekday: 6, startYear: 2024 });
    expect(normalizeRecurrence(weekday)).toEqual(weekday);
  });
  it('still keeps real years, as numbers or strings', () => {
    expect(normalizeRecurrence({ freq: 'yearly', month: 11, day: 28, startYear: '2024', endYear: 2030 }))
      .toMatchObject({ startYear: 2024, endYear: 2030 });
  });
});

describe('a yearly rule with no start year', () => {
  const e = event({ freq: 'yearly', mode: 'date', month: 11, day: 28 });
  it('still has occurrences', () => {
    expect(occurrenceForYear(e, 2026).start).toEqual(date);
    expect(nextOccurrence(e, now).start).toEqual(date);
  });
  it('does not claim to end', () => {
    expect(describeRecurrence(e.recurrence)).toBe('Every year on November 28');
  });
  it('honours an end year on its own', () => {
    const ended = event({ freq: 'yearly', mode: 'date', month: 11, day: 28, endYear: 2025 });
    expect(occurrenceForYear(ended, 2025)).not.toBeNull();
    expect(occurrenceForYear(ended, 2026)).toBeNull();
  });
});
