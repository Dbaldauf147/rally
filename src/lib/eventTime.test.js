// Setting the time of day on an event whose date is already settled.
import { describe, it, expect } from 'vitest';
import { isAllDay, formatWhen, timeInputValue, withTimeOfDay } from './eventTime';

const at = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi);

describe('timeInputValue', () => {
  it('reads the clock off the date', () => {
    expect(timeInputValue({}, at(2026, 9, 16, 18, 30))).toBe('18:30');
  });

  it('pads both halves, so a time input will accept it', () => {
    expect(timeInputValue({}, at(2026, 9, 16, 9, 5))).toBe('09:05');
  });

  it('is blank for an all-day event, whatever the stored date says', () => {
    expect(timeInputValue({ allDay: true }, at(2026, 9, 16, 12, 0))).toBe('');
  });

  it('is blank rather than wrong when there is no usable date', () => {
    expect(timeInputValue({}, new Date('nonsense'))).toBe('');
    expect(timeInputValue({}, null)).toBe('');
  });
});

describe('withTimeOfDay', () => {
  it('moves the clock and leaves the day alone', () => {
    const out = withTimeOfDay(at(2026, 9, 16, 12, 0), '18:30');
    expect([out.getFullYear(), out.getMonth() + 1, out.getDate()]).toEqual([2026, 9, 16]);
    expect([out.getHours(), out.getMinutes()]).toEqual([18, 30]);
  });

  // Finalizing stores noon local. Rebuilding the day from an ISO string instead
  // of the Date is how an evening event lands on the day before.
  it('keeps the local day for a late time', () => {
    const out = withTimeOfDay(at(2026, 9, 16, 12, 0), '23:45');
    expect(out.getDate()).toBe(16);
    expect(out.getHours()).toBe(23);
  });

  it('reads a blank time as midnight, which is what all-day stores', () => {
    const out = withTimeOfDay(at(2026, 9, 16, 12, 0), '');
    expect([out.getHours(), out.getMinutes(), out.getSeconds()]).toEqual([0, 0, 0]);
  });

  it('clears the seconds, so two saves of the same time are the same instant', () => {
    const messy = new Date(2026, 8, 16, 12, 0, 44, 500);
    expect(withTimeOfDay(messy, '18:00').getSeconds()).toBe(0);
    expect(withTimeOfDay(messy, '18:00').getMilliseconds()).toBe(0);
  });

  it('has nothing to give back without a usable date', () => {
    expect(withTimeOfDay(new Date('nonsense'), '18:00')).toBeNull();
    expect(withTimeOfDay(null, '18:00')).toBeNull();
  });
});

describe('what the hero then prints', () => {
  it('appends the time once one is set', () => {
    const d = withTimeOfDay(at(2026, 9, 16, 12, 0), '18:30');
    expect(formatWhen({ allDay: false }, d, 'EEEE, MMMM d, yyyy'))
      .toBe('Wednesday, September 16, 2026 · 6:30 PM');
  });

  it('says only the day once the time is cleared', () => {
    const d = withTimeOfDay(at(2026, 9, 16, 12, 0), '');
    expect(formatWhen({ allDay: true }, d, 'EEEE, MMMM d, yyyy'))
      .toBe('Wednesday, September 16, 2026');
    expect(isAllDay({ allDay: true })).toBe(true);
  });
});
