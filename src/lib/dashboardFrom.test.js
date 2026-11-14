import { describe, it, expect } from 'vitest';
import {
  normalizeDashboardFrom, buildDashboardFrom, dashboardShowDay, dashboardShowYmd,
  isShowingLater, splitShowingLater,
} from './dashboardFrom';

const ME = 'me';
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const yearly = { freq: 'yearly', mode: 'date', month: 10, day: 31, startYear: 2026, endYear: null };

describe('the stored setting', () => {
  it('records the picked day and how far ahead of the event it is', () => {
    expect(buildDashboardFrom('2027-09-01', new Date(2027, 9, 31, 19, 0)))
      .toEqual({ date: '2027-09-01', daysBefore: 60 });
    // Same day as the event: zero days ahead, still a real setting.
    expect(buildDashboardFrom('2027-10-31', new Date(2027, 9, 31, 19, 0)))
      .toEqual({ date: '2027-10-31', daysBefore: 0 });
  });

  it('keeps the day alone when there is no event date to measure from', () => {
    expect(buildDashboardFrom('2027-09-01', null)).toEqual({ date: '2027-09-01', daysBefore: null });
  });

  it('is nothing when the field was left empty', () => {
    expect(buildDashboardFrom('', new Date())).toBeNull();
  });

  it('rejects junk', () => {
    expect(normalizeDashboardFrom(null)).toBeNull();
    expect(normalizeDashboardFrom({ date: 'soon' })).toBeNull();
    expect(normalizeDashboardFrom({ date: '2027-09-01', daysBefore: -3 }))
      .toEqual({ date: '2027-09-01', daysBefore: null });
    // null must not turn into "0 days before".
    expect(normalizeDashboardFrom({ date: '2027-09-01', daysBefore: null }).daysBefore).toBeNull();
  });
});

describe('a one-off event', () => {
  const event = {
    date: new Date(2027, 9, 31),
    dashboardFrom: { [ME]: { date: '2027-09-01', daysBefore: 60 } },
  };

  it('is held back until the picked day, then shows', () => {
    expect(isShowingLater(event, ME, new Date(2027, 7, 31, 23, 59))).toBe(true);
    expect(isShowingLater(event, ME, new Date(2027, 8, 1, 0, 1))).toBe(false);
  });

  it('is only held back for the person who asked', () => {
    expect(isShowingLater(event, 'someone-else', new Date(2027, 0, 1))).toBe(false);
    expect(isShowingLater(event, undefined, new Date(2027, 0, 1))).toBe(false);
  });

  it('is not held back past its own date', () => {
    const moved = { ...event, date: new Date(2027, 5, 1) };
    expect(isShowingLater(moved, ME, new Date(2027, 4, 1))).toBe(false);
  });
});

describe('a yearly event', () => {
  const setting = { [ME]: { date: '2026-09-01', daysBefore: 60 } };
  // What useEvents hands the dashboard: `date` rolled forward to the next occurrence.
  const next = { recurrence: yearly, date: new Date(2027, 9, 31), dashboardFrom: setting };

  it('comes back the same distance ahead of each year’s date', () => {
    expect(ymd(dashboardShowDay(next, ME))).toBe('2027-09-01');
    expect(isShowingLater(next, ME, new Date(2026, 10, 14))).toBe(true);
    expect(isShowingLater(next, ME, new Date(2027, 8, 1))).toBe(false);
    const after = { ...next, date: new Date(2028, 9, 31) };
    expect(ymd(dashboardShowDay(after, ME))).toBe('2028-09-01');
    expect(isShowingLater(after, ME, new Date(2027, 10, 1))).toBe(true);
  });

  it('fills the form from the date the form is showing', () => {
    const anchor = { ...next, date: new Date(2026, 9, 31) };
    expect(dashboardShowYmd(anchor, ME)).toBe('2026-09-01');
    expect(dashboardShowYmd({ date: new Date(2026, 9, 31) }, ME)).toBe('');
  });
});

describe('an event with no date yet', () => {
  it('uses the picked day as it stands', () => {
    const event = { dateTBD: true, date: new Date(2026, 0, 1), dashboardFrom: { [ME]: { date: '2027-03-01', daysBefore: null } } };
    expect(isShowingLater(event, ME, new Date(2027, 1, 28))).toBe(true);
    expect(isShowingLater(event, ME, new Date(2027, 2, 1))).toBe(false);
  });
});

describe('splitting a dashboard', () => {
  it('pulls the held-back events out, soonest to show first', () => {
    const a = { id: 'a', date: new Date(2027, 11, 25), dashboardFrom: { [ME]: { date: '2027-12-01', daysBefore: 24 } } };
    const b = { id: 'b', date: new Date(2027, 9, 31), dashboardFrom: { [ME]: { date: '2027-09-01', daysBefore: 60 } } };
    const c = { id: 'c', date: new Date(2027, 5, 1) };
    const { showing, later } = splitShowingLater([a, b, c], ME, new Date(2027, 0, 1));
    expect(showing.map(e => e.id)).toEqual(['c']);
    expect(later.map(e => e.id)).toEqual(['b', 'a']);
  });
});
