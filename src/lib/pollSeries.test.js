import { describe, it, expect } from 'vitest';
import {
  normalizePollSeries, nextRoundDue, targetMonth, seedOptions, nextRoundMembers, buildNextRound,
  seededWeekdaysLabel, describePollSeries, monthLabel,
} from './pollSeries';

// Noon UTC keeps every date on the same calendar day in US Eastern.
const at = (s) => new Date(`${s}T16:00:00Z`);
const round = (over = {}) => ({
  title: 'Game night', createdBy: 'u1', stage: 'finalized', dateTBD: false,
  date: at('2026-10-17'), endDate: null,
  pollSeries: { everyMonths: 1, seriesId: '', round: 1 },
  members: { u1: { role: 'owner', name: 'Dan', rsvp: 'yes' } }, memberUids: ['u1'],
  ...over,
});

describe('normalizePollSeries', () => {
  it('keeps known cadences only', () => {
    expect(normalizePollSeries({ everyMonths: 3 })).toEqual({ everyMonths: 3, seriesId: '', round: 1 });
    expect(normalizePollSeries({ everyMonths: 5 })).toBeNull();
    expect(normalizePollSeries(null)).toBeNull();
    expect(describePollSeries({ everyMonths: 12 })).toBe('Every year — a new poll picks each round’s date'.replace('’', "'"));
  });
});

describe('nextRoundDue', () => {
  it('only once a finalized round’s last day is behind us', () => {
    expect(nextRoundDue(round(), at('2026-10-17'))).toBe(false); // the day itself
    expect(nextRoundDue(round(), at('2026-10-18'))).toBe(true);
    expect(nextRoundDue(round({ endDate: at('2026-10-19') }), at('2026-10-19'))).toBe(false);
    expect(nextRoundDue(round({ endDate: at('2026-10-19') }), at('2026-10-20'))).toBe(true);
  });
  it('not while voting, cancelled, already followed, or outside a series', () => {
    const later = at('2026-11-30');
    expect(nextRoundDue(round({ stage: 'voting' }), later)).toBe(false);
    expect(nextRoundDue(round({ dateTBD: true }), later)).toBe(false);
    expect(nextRoundDue(round({ cancelled: true }), later)).toBe(false);
    expect(nextRoundDue(round({ nextRoundId: 'x' }), later)).toBe(false);
    expect(nextRoundDue(round({ pollSeries: null }), later)).toBe(false);
  });
});

describe('targetMonth', () => {
  it('moves on by the cadence, across the year end', () => {
    expect(targetMonth(round(), 1)).toEqual({ year: 2026, month: 11 });
    expect(targetMonth(round(), 3)).toEqual({ year: 2027, month: 1 });
    expect(targetMonth(round(), 12)).toEqual({ year: 2027, month: 10 });
    expect(monthLabel({ year: 2027, month: 1 })).toBe('January 2027');
  });
});

describe('seedOptions', () => {
  it('offers the same weekdays, with the same lengths, in the target month', () => {
    const last = [
      { startDate: '2026-10-09', endDate: '2026-10-09' }, // Fri
      { startDate: '2026-10-10', endDate: '2026-10-11' }, // Sat–Sun
    ];
    const out = seedOptions(last, { year: 2026, month: 11 });
    expect(out.slice(0, 3)).toEqual([
      { startDate: '2026-11-06', endDate: '2026-11-06' },
      { startDate: '2026-11-07', endDate: '2026-11-08' },
      { startDate: '2026-11-13', endDate: '2026-11-13' },
    ]);
    expect(out).toHaveLength(8);
    expect(seededWeekdaysLabel(out)).toBe('Fridays & Saturdays');
  });
  it('falls back to the weekday the round landed on', () => {
    expect(seedOptions([], { year: 2026, month: 11 }, '2026-10-17').map((o) => o.startDate))
      .toEqual(['2026-11-07', '2026-11-14', '2026-11-21', '2026-11-28']);
  });
  it('caps a busy pattern', () => {
    const everyDay = Array.from({ length: 7 }, (_, i) => ({ startDate: `2026-10-0${i + 1}`, endDate: `2026-10-0${i + 1}` }));
    expect(seedOptions(everyDay, { year: 2026, month: 11 })).toHaveLength(12);
  });
});

describe('nextRoundMembers', () => {
  it('keeps the people and clears their answers', () => {
    const out = nextRoundMembers({
      u1: { role: 'owner', name: 'Dan', rsvp: 'yes' },
      g1: { name: 'Sam', email: 's@x.com', rsvp: 'no', texted: true, attendance: 'went', eventGroup: 'College', plusOneOf: 'u1' },
    });
    expect(out).toEqual({
      u1: { role: 'owner', name: 'Dan', rsvp: 'yes' },
      g1: { name: 'Sam', email: 's@x.com', eventGroup: 'College', plusOneOf: 'u1', rsvp: 'pending' },
    });
  });
});

describe('buildNextRound', () => {
  it('is a new voting round in the series, linked back', () => {
    const { doc, target } = buildNextRound(round({ autoReminders: { enabled: true, intervals: [3] } }), 'ev1', { shareToken: 'tok' });
    expect(target).toEqual({ year: 2026, month: 11 });
    expect(doc).toMatchObject({
      title: 'Game night', stage: 'voting', dateTBD: true, recurrence: null,
      pollSeries: { everyMonths: 1, seriesId: 'ev1', round: 2 },
      previousRoundId: 'ev1', shareToken: 'tok', memberUids: ['u1'], targetMonth: { year: 2026, month: 11 },
    });
    expect(doc.autoReminders.enabled).toBe(true);
    expect(doc.autoReminders.intervals).toEqual([3]);
    expect(doc.nextRoundId).toBeUndefined();
  });
  it('keeps an existing series id', () => {
    expect(buildNextRound(round({ pollSeries: { everyMonths: 1, seriesId: 'first', round: 4 } }), 'ev4').doc.pollSeries)
      .toEqual({ everyMonths: 1, seriesId: 'first', round: 5 });
  });
});
