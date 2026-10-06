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

describe('send dates', () => {
  it('step on by the cadence, held to the month end', async () => {
    const { addMonthsYmd, nextSendDate, pollWindow, windowLabel, sendDateLabel } = await import('./pollSeries');
    expect(addMonthsYmd('2026-10-20', 1)).toBe('2026-11-20');
    expect(addMonthsYmd('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsYmd('2026-11-15', 3)).toBe('2027-02-15');
    expect(nextSendDate({ pollSeries: { everyMonths: 2 }, pollSendDate: '2026-10-20' })).toBe('2026-12-20');
    expect(nextSendDate({ pollSeries: { everyMonths: 2 } })).toBe('');
    expect(pollWindow('2026-10-20', 1)).toEqual({ from: '2026-10-27', to: '2026-11-26' });
    expect(windowLabel({ from: '2026-12-27', to: '2027-01-26' })).toBe('Dec 27 – Jan 26, 2027');
    expect(sendDateLabel('2026-10-20', '2026-10-06')).toBe('Oct 20');
    expect(sendDateLabel('2027-01-05', '2026-10-06')).toBe('Jan 5, 2027');
  });

  it('decide when a round is emailed and when the next one opens', async () => {
    const { pollSendDue, nextRoundDue } = await import('./pollSeries');
    const r = { pollSeries: { everyMonths: 1 }, pollSendDate: '2026-10-20', stage: 'voting', dateTBD: true };
    expect(pollSendDue(r, at('2026-10-19'))).toBe(false);
    expect(pollSendDue(r, at('2026-10-20'))).toBe(true);
    expect(pollSendDue({ ...r, pollSentAt: 'x' }, at('2026-10-21'))).toBe(false);
    expect(pollSendDue({ ...r, cancelled: true }, at('2026-10-21'))).toBe(false);
    // The next round goes by the schedule, finalized or not.
    expect(nextRoundDue(r, at('2026-11-19'))).toBe(false);
    expect(nextRoundDue(r, at('2026-11-20'))).toBe(true);
    expect(nextRoundDue({ ...r, nextRoundId: 'n' }, at('2026-11-20'))).toBe(false);
  });

  it('carry into the next round with its window', async () => {
    const { buildNextRound, seedOptionsInRange } = await import('./pollSeries');
    const { doc, window } = buildNextRound(round({ pollSendDate: '2026-10-20' }), 'ev1');
    expect(doc.pollSendDate).toBe('2026-11-20');
    expect(window).toEqual({ from: '2026-11-27', to: '2026-12-26' });
    expect(doc.pollWindow).toEqual(window);
    expect(doc.targetMonth).toBeUndefined();
    expect(seedOptionsInRange([{ startDate: '2026-10-24', endDate: '2026-10-24' }], window).map((o) => o.startDate))
      .toEqual(['2026-11-28', '2026-12-05', '2026-12-12', '2026-12-19', '2026-12-26']);
  });
});
